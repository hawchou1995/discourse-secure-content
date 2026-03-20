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
      preview: "🔒 隐藏内容预览"
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

  // 1. 完美修复 i18n
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

  const replyStatusCache = new Map();
  async function checkUserReplied(userId, topicId) {
    const key = `${userId}:${topicId}`;
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    if (currentUser && currentUser.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }
    if (document.querySelector(`article[data-user-id="${userId}"]`)) {
        replyStatusCache.set(key, true); return true;
    }
    try {
      const result = await ajax(`/t/${topicId}.json`);
      let hasPost = result.details?.user_data?.posted || result.details?.participants?.some(p => p.id === userId) || false;
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) { return false; }
  }

  function renderMask(el, type, icon, msgHtml) {
      const maskNode = document.createElement("span");
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
      el.innerHTML = ""; 
      el.appendChild(maskNode);
      el.style.display = "flex"; 
  }

  // 终极杀手锏：利用原生 Range API 切割 DOM，不伤及任何 Ember/Callout 结构！
  function wrapSecureTags(element, type) {
      const startTag = `[${type}]`;
      const endTag = `[/${type}]`;
      let hasChanges = false;
      let safety = 100; // 防止异常嵌套死循环

      while (safety-- > 0) {
          let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
          let startNode = null;
          while (walker.nextNode()) {
              if (walker.currentNode.nodeValue.toLowerCase().includes(startTag)) {
                  startNode = walker.currentNode;
                  break;
              }
          }
          if (!startNode) break; 

          // 切割出纯净的起始标签节点
          let startIdx = startNode.nodeValue.toLowerCase().indexOf(startTag);
          let startTagNode = startNode.splitText(startIdx);
          startTagNode.splitText(startTag.length);

          walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
          let endNode = null;
          while (walker.nextNode()) {
              if (walker.currentNode.nodeValue.toLowerCase().includes(endTag)) {
                  endNode = walker.currentNode;
                  break;
              }
          }

          if (!endNode) {
              startTagNode.nodeValue = ""; // 只有头没有尾，抹除防止报错
              break;
          }

          // 切割出纯净的结束标签节点
          let endIdx = endNode.nodeValue.toLowerCase().indexOf(endTag);
          let endTagNode = endNode.splitText(endIdx);
          endTagNode.splitText(endTag.length);

          // 清理 Markdown 解析时可能在标签旁生成的无用 <br>，保持排版美观
          if (startTagNode.nextSibling && startTagNode.nextSibling.nodeName === 'BR') {
              startTagNode.nextSibling.remove();
          }
          if (endTagNode.previousSibling && endTagNode.previousSibling.nodeName === 'BR') {
              endTagNode.previousSibling.remove();
          }

          // 创建原生选区打包内容
          let range = document.createRange();
          range.setStartAfter(startTagNode);
          range.setEndBefore(endTagNode);

          let content = range.extractContents();
          let wrapper = document.createElement('span');
          wrapper.className = 'secure-wrapper';
          wrapper.dataset.secureType = type;
          wrapper.style.display = 'block';
          wrapper.appendChild(content);

          range.insertNode(wrapper);

          // 销毁首尾标签占位符
          startTagNode.remove();
          endTagNode.remove();
          hasChanges = true;
      }
      return hasChanges;
  }

  api.decorateCookedElement(
    async (element, helper) => {
      try {
        let changedLogin = wrapSecureTags(element, 'login');
        let changedReply = wrapSecureTags(element, 'reply');

        const secureElements = element.querySelectorAll(".secure-wrapper");
        
        if (!secureElements.length) {
            // 即使没有隐藏内容，如果有替换操作，也可能暴露出网盘链接，呼叫护盾
            if ((changedLogin || changedReply) && window.applyExternalLinkShield) {
                window.applyExternalLinkShield(element);
            }
            return;
        }

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.id || helper?.widget?.model?.topic_id || helper?.widget?.model?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        // 编辑器预览状态
        if (!topicId && !document.body.classList.contains("topic-page")) {
          secureElements.forEach(el => {
              el.classList.add("secure-preview");
              el.setAttribute("data-preview-prefix", txt.preview);
              el.style.display = "block";
          });
          if (window.applyExternalLinkShield) window.applyExternalLinkShield(element);
          return; 
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
            renderMask(el, type, icon, msgHtml);
          } else {
            // 解锁
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            el.style.display = "block";
            // 呼叫隔壁护盾插件，给解锁出来的内容补上云朵/绿锁图标！
            if (window.applyExternalLinkShield) window.applyExternalLinkShield(el);
          }
        });
      } catch (err) {
        console.error("Secure Content Error:", err);
      }
    },
    { id: "secure-content-decorator" } 
  );
});
