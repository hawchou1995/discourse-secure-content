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
  // 2. 权限校验逻辑 (【核心优化】修复千人帖子的漏判Bug)
  // ==========================================
  const replyStatusCache = new Map();
  async function checkUserReplied(user, topicId) {
    if (!user || !topicId) return false;
    const key = `${user.id}:${topicId}`;
    
    // 1. 命中缓存
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    
    // 2. 快速判断：如果用户总发帖数为0，肯定没回复过
    if (user.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }
    
    // 3. O(1) 前端判断：快速检查当前 DOM 中有没有该用户的楼层
    if (document.querySelector(`article[data-user-id="${user.id}"]`)) {
        replyStatusCache.set(key, true); return true;
    }
    
    // 4. 终极防御：利用 Search API 精确查找（不受 participants 24人上限影响）
    try {
      // 语法糖: topic:1234 @username
      const searchQuery = `topic:${topicId} @${user.username}`;
      const result = await ajax(`/search/query.json`, { data: { q: searchQuery } });
      let hasPost = (result && result.posts && result.posts.length > 0);
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) { 
      console.warn("[Secure Content] Reply check failed:", e);
      return false; 
    }
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
  // 3. Markdown 渲染劫持
  // ==========================================
  api.registerMarkdownItPlugin("secure-content", (md) => {
    const secureContentRule = (state, startLine, endLine, silent) => {
      let start = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];

      if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;

      let tagMatch = state.src.slice(start, max).match(/^\[(login|reply)\]/i);
      if (!tagMatch) return false;

      let type = tagMatch[1].toLowerCase();
      let closeTag = `[/${type}]`;

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

      let token;
      token = state.push("secure_content_open", "div", 1);
      token.attrs = [["class", "secure-wrapper"], ["data-secure-type", type]];
      token.map = [startLine, nextLine];

      state.md.block.tokenize(state, startLine + 1, nextLine);

      token = state.push("secure_content_close", "div", -1);

      state.line = nextLine + 1;
      return true;
    };

    md.block.ruler.before("paragraph", "secure_content", secureContentRule);
  });

  // ==========================================
  // 4. 防御性注入辅助函数 (隔离外链护盾组件的崩溃风险)
  // ==========================================
  function safeApplyLinkShield(targetNode) {
    if (typeof window.applyExternalLinkShield === 'function') {
      try {
        // 使用 setTimeout 确保浏览器完成解锁内容的 DOM 渲染后，再绑定护盾事件
        setTimeout(() => {
            window.applyExternalLinkShield(targetNode);
        }, 50);
      } catch (err) {
        console.warn("[Secure Content] 外链护盾执行异常，已风险隔离:", err);
      }
    }
  }

  // ==========================================
  // 5. 状态切换核心逻辑
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
          // 预览区解禁时应用护盾
          safeApplyLinkShield(element);
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
           // 传入整个 currentUser 对象，以便同时获取 ID 和 Username
           hasReplied = await checkUserReplied(currentUser, topicId);
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
              let maskNode = renderMask(type, icon, msgHtml);
              
              Array.from(el.childNodes).forEach(child => {
                  if (child.nodeType === Node.ELEMENT_NODE) {
                      child.style.display = 'none';
                      child.classList.add('secure-hidden-element');
                  } else if (child.nodeType === Node.TEXT_NODE) {
                      let span = document.createElement('span');
                      span.style.display = 'none';
                      span.classList.add('secure-hidden-element');
                      el.insertBefore(span, child);
                      span.appendChild(child);
                  }
              });

              el.prepend(maskNode);
          } else {
            // 解锁状态：展示内容
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            
            // 真实贴文区域解禁时应用安全护盾
            safeApplyLinkShield(el);
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
