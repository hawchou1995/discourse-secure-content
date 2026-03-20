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
      el.innerHTML = ""; 
      el.appendChild(maskNode);
  }

  function wrapSecureTags(element, type) {
      const startTag = `[${type}]`;
      const endTag = `[/${type}]`;
      let hasChanges = false;
      let safety = 50; 

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

          let startIdx = startNode.nodeValue.toLowerCase().indexOf(startTag);
          let startTagNode = startNode.splitText(startIdx);
          startTagNode.splitText(startTag.length);

          walker.currentNode = startTagNode;
          let endNode = null;
          while (walker.nextNode()) {
              if (walker.currentNode.nodeValue.toLowerCase().includes(endTag)) {
                  endNode = walker.currentNode;
                  break;
              }
          }

          if (!endNode) {
              startTagNode.nodeValue = ""; 
              break;
          }

          let endIdx = endNode.nodeValue.toLowerCase().indexOf(endTag);
          let endTagNode = endNode.splitText(endIdx);
          endTagNode.splitText(endTag.length);

          let range = document.createRange();
          range.setStartAfter(startTagNode);
          range.setEndBefore(endTagNode);

          let content = range.extractContents();
          
          // 【强力除杂】去除被提取内容头部和尾部的空行/换行
          while (content.firstChild && (content.firstChild.nodeName === 'BR' || (content.firstChild.nodeType === Node.TEXT_NODE && content.firstChild.nodeValue.trim() === ''))) {
              content.firstChild.remove();
          }
          while (content.lastChild && (content.lastChild.nodeName === 'BR' || (content.lastChild.nodeType === Node.TEXT_NODE && content.lastChild.nodeValue.trim() === ''))) {
              content.lastChild.remove();
          }

          let wrapper = document.createElement('div');
          wrapper.className = 'secure-wrapper';
          wrapper.dataset.secureType = type;
          wrapper.appendChild(content);

          range.insertNode(wrapper);

          // 销毁首尾标签占位符
          startTagNode.remove();
          endTagNode.remove();

          // 顺手删掉被抽空的外层 P 标签
          element.querySelectorAll('p').forEach(p => {
              if (p.innerHTML.trim() === '' || p.innerHTML.trim() === '<br>') {
                  p.remove();
              }
          });

          hasChanges = true;
      }
      return hasChanges;
  }

  async function applySecureContent(element, helper) {
      try {
        let changedLogin = wrapSecureTags(element, 'login');
        let changedReply = wrapSecureTags(element, 'reply');

        const secureElements = element.querySelectorAll(".secure-wrapper:not(.processed)");
        if (!secureElements.length) {
            if ((changedLogin || changedReply) && window.applyExternalLinkShield) {
                window.applyExternalLinkShield(element);
            }
            return;
        }
        
        secureElements.forEach(el => el.classList.add("processed"));

        // 【精准判定预览区】：不管有没有 TopicID，只要在 .d-editor-preview 容器内，就强制处于预览模式
        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        if (isPreview) {
          secureElements.forEach(el => {
              el.classList.remove("secure-wrapper"); // 移除原生隐藏类
              el.classList.add("secure-preview"); // 替换为预览独立类
              el.setAttribute("data-preview-prefix", txt.preview);
          });
          if (window.applyExternalLinkShield) window.applyExternalLinkShield(element);
          return; // 预览区直接结束，不再去请求后台解锁逻辑
        }

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.id || helper?.widget?.model?.topic_id || helper?.widget?.model?.id;
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
            renderMask(el, type, icon, msgHtml);
          } else {
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            if (window.applyExternalLinkShield) window.applyExternalLinkShield(el);
          }
        });
      } catch (err) {
        console.error("Secure Content Error:", err);
      }
  }

  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);
        if (typeof MutationObserver !== "undefined") {
            let isProcessing = false;
            const observer = new MutationObserver(() => {
                if (isProcessing) return;
                isProcessing = true;
                applySecureContent(element, helper).finally(() => {
                    isProcessing = false;
                });
            });
            observer.observe(element, { childList: true, subtree: true });
        }
    },
    { id: "secure-content-decorator" } 
  );
});
