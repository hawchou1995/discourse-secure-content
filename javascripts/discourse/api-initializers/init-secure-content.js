import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();
  const locale = window.I18n ? window.I18n.currentLocale() : "zh_CN";
  const lang = locale.startsWith("zh") ? "zh" : "en";

  const txt = {
    zh: {
      btn_login: "插入登录可见",
      btn_reply: "插入回复可见",
      txt_login: "此处内容登录后可见...",
      txt_reply: "此处内容回复后可见...",
      mask_login: `此内容仅供登录用户查看，请 <a href="/login" class="secure-link-btn">登录</a>`,
      mask_reply: `此内容隐藏，请 <a href="#" class="secure-link-btn trigger-reply">回复本帖</a> 后查看`,
      mask_login_reply: `此内容需回复可见，请先 <a href="/login" class="secure-link-btn">登录</a>`,
      preview: "🔒 隐藏内容预览（正式发布后根据权限显示）"
    },
    en: {
      btn_login: "Insert Login Block",
      btn_reply: "Insert Reply Block",
      txt_login: "Content visible after login...",
      txt_reply: "Content visible after reply...",
      mask_login: `Content hidden. Please <a href="/login" class="secure-link-btn">Log In</a> to view.`,
      mask_reply: `Content hidden. Please <a href="#" class="secure-link-btn trigger-reply">Reply</a> to view.`,
      mask_login_reply: `Reply required. Please <a href="/login" class="secure-link-btn">Log In</a> first.`,
      preview: "🔒 Hidden Content Preview"
    }
  }[lang];

  // ==========================================
  // 1. 国际化与编辑器按钮
  // ==========================================
  if (window.I18n && window.I18n.translations && window.I18n.translations[locale]) {
      let trans = window.I18n.translations[locale];
      trans.js = trans.js || {};
      trans.js.secure_login_btn = txt.btn_login;
      trans.js.secure_reply_btn = txt.btn_reply;
      trans.js.composer = trans.js.composer || {};
      trans.js.composer.secure_login_text = txt.txt_login;
      trans.js.composer.secure_reply_text = txt.txt_reply;
  }

  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "insertions",
      icon: "lock",
      title: "secure_login_btn",
      perform: (e) => e.applySurround("\n[login]\n", "\n[/login]\n", "secure_login_text")
    });
    toolbar.addButton({
      id: "insert_reply_tag",
      group: "insertions",
      icon: "comment",
      title: "secure_reply_btn",
      perform: (e) => e.applySurround("\n[reply]\n", "\n[/reply]\n", "secure_reply_text")
    });
  });

  // ==========================================
  // 2. 权限校验逻辑
  // ==========================================
  const replyStatusCache = new Map();
  async function checkUserReplied(userId, topicId) {
    const key = `${userId}:${topicId}`;
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    if (currentUser && currentUser.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }
    // 快速检查当前页面有没有这个用户的帖子
    if (document.querySelector(`article[data-user-id="${userId}"]`)) {
        replyStatusCache.set(key, true); return true;
    }
    // 降级：发 API 请求
    try {
      const result = await ajax(`/t/${topicId}.json`);
      let hasPost = result.details?.user_data?.posted || result.details?.participants?.some(p => p.id === userId) || false;
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) { return false; }
  }

  function renderMask(type, icon, msgHtml) {
      const maskNode = document.createElement("div");
      maskNode.className = `secure-content-mask apple-style type-${type}`;
      maskNode.innerHTML = `
          <span class="secure-icon-container">
            <svg class="fa d-icon d-icon-${icon} svg-icon"><use href="#${icon}"></use></svg>
          </span>
          <span class="secure-text">${msgHtml}</span>
       `;
      const replyTrigger = maskNode.querySelector(".trigger-reply");
      if (replyTrigger) {
        replyTrigger.addEventListener("click", (e) => {
            e.preventDefault();
            const btn = document.querySelector(".topic-footer-main-buttons .create") || document.querySelector(".post-action-menu__reply");
            if (btn) btn.click();
            else window.scrollTo(0, document.body.scrollHeight);
        });
      }
      return maskNode;
  }

  // ==========================================
  // 3. 【核心优化】接管 Markdown 渲染，不再做恶心的 DOM 字符串替换！
  // ==========================================
  
  // 注册一个 Markdown 块级规则
  api.registerMarkdownItPlugin("secure-content", (md) => {
    // 编写自定义规则来处理 [login] 和 [reply] 标签
    const secureContentRule = (state, startLine, endLine, silent) => {
      let start = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];

      // 如果不是以 '[' 开头，直接跳过
      if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;

      let tagMatch = state.src.slice(start, max).match(/^\[(login|reply)\]/i);
      if (!tagMatch) return false;

      let type = tagMatch[1].toLowerCase();
      let closeTag = `[/${type}]`;

      // 寻找结束标签
      let nextLine = startLine;
      let foundClose = false;
      
      while (nextLine < endLine) {
        nextLine++;
        if (nextLine >= endLine) break;

        start = state.bMarks[nextLine] + state.tShift[nextLine];
        max = state.eMarks[nextLine];

        if (state.src.slice(start, max).trim().toLowerCase() === closeTag) {
          foundClose = true;
          break;
        }
      }

      if (!foundClose) return false;
      if (silent) return true;

      // 生成安全的 Token 树
      let token;
      
      // 开启一个 div，给它打上我们自己的属性
      token = state.push("secure_content_open", "div", 1);
      token.attrs = [["class", "secure-wrapper"], ["data-secure-type", type]];
      token.map = [startLine, nextLine];

      // 将中间的内容交给 Markdown 继续递归解析
      state.md.block.tokenize(state, startLine + 1, nextLine);

      // 关闭 div
      token = state.push("secure_content_close", "div", -1);

      state.line = nextLine + 1;
      return true;
    };

    // 把规则插入到 Markdown 解析流中，优先级高于段落
    md.block.ruler.before("paragraph", "secure_content", secureContentRule);
  });


  // ==========================================
  // 4. 只负责状态切换，不动 DOM 结构！
  // ==========================================
  async function applySecureContent(element, helper) {
      try {
        const secureElements = element.querySelectorAll(".secure-wrapper:not(.processed)");
        
        if (!secureElements.length) return;
        
        secureElements.forEach(el => el.classList.add("processed"));

        // 【精准判定预览区】
        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        
        if (isPreview) {
          secureElements.forEach(el => {
              el.classList.remove("secure-wrapper");
              el.classList.add("secure-preview");
              el.setAttribute("data-preview-prefix", txt.preview);
          });
          if (window.applyExternalLinkShield) window.applyExternalLinkShield(element);
          return; 
        }

        // 兼容新旧获取 ID 的方式
        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        const needsReplyCheck = Array.from(secureElements).some(el => el.dataset.secureType === "reply");
        if (needsReplyCheck && currentUser && topicId) {
           hasReplied = await checkUserReplied(currentUser.id, topicId);
        }

        secureElements.forEach((el) => {
          const type = el.dataset.secureType;
          let isLocked = true;
          let msgHtml = "";
          let icon = "lock";

          if (type === "login") {
            if (currentUser) isLocked = false; 
            else { msgHtml = txt.mask_login; icon = "lock"; }
          } else if (type === "reply") {
            if (!currentUser) { msgHtml = txt.mask_login_reply; icon = "lock"; }
            else if (hasReplied || currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id) isLocked = false;
            else { msgHtml = txt.mask_reply; icon = "reply"; }
          }

          if (isLocked) {
              // 锁定状态：把原来里面的内容全部设为 display: none，插入面具
              let maskNode = renderMask(type, icon, msgHtml);
              
              // 遍历子节点并隐藏，绝不使用 innerHTML 替换，保护 Glimmer
              Array.from(el.childNodes).forEach(child => {
                  if (child.nodeType === Node.ELEMENT_NODE) {
                      child.style.display = 'none';
                      child.classList.add('secure-hidden-element');
                  } else if (child.nodeType === Node.TEXT_NODE) {
                      // 包装一下文本节点
                      let span = document.createElement('span');
                      span.style.display = 'none';
                      span.classList.add('secure-hidden-element');
                      el.insertBefore(span, child);
                      span.appendChild(child);
                  }
              });

              el.prepend(maskNode);
          } else {
            // 解锁状态：直接移除外壳的隐藏属性
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            if (window.applyExternalLinkShield) window.applyExternalLinkShield(el);
          }
        });
      } catch (err) {
        console.error("Secure Content Error:", err);
      }
  }

  // 最终挂载
  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);
    },
    { id: "secure-content-decorator" } 
  );
});
