import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();
  const lang = (window.I18n ? window.I18n.currentLocale() : "zh_CN").startsWith("zh") ? "zh" : "en";

  const txt = {
    zh: {
      btn_login: "插入登录可见",
      btn_reply: "插入回复可见",
      txt_login: "此处内容登录后可见",
      txt_reply: "此处内容回复后可见",
      mask_login: `此内容仅供登录用户查看，请 <a href="/login" class="secure-link-btn">登录</a>`,
      mask_reply: `此内容隐藏，请 <a href="#" class="secure-link-btn trigger-reply">回复本帖</a> 后查看`,
      mask_login_reply: `此内容需回复可见，请先 <a href="/login" class="secure-link-btn">登录</a>`,
      preview: "🔒 隐藏内容预览"
    },
    en: {
      btn_login: "Insert Login Block",
      btn_reply: "Insert Reply Block",
      txt_login: "Content visible after login",
      txt_reply: "Content visible after reply",
      mask_login: `Content hidden. Please <a href="/login" class="secure-link-btn">Log In</a> to view.`,
      mask_reply: `Content hidden. Please <a href="#" class="secure-link-btn trigger-reply">Reply</a> to view.`,
      mask_login_reply: `Reply required. Please <a href="/login" class="secure-link-btn">Log In</a> first.`,
      preview: "🔒 Hidden Content Preview"
    }
  }[lang];

  // 1. 修复：使用正确的组名 "insertions"，按钮完美回归
  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "insertions",
      icon: "lock",
      title: txt.btn_login,
      perform: (e) => e.applySurround("\n[login]\n", "\n[/login]\n", txt.txt_login)
    });
    toolbar.addButton({
      id: "insert_reply_tag",
      group: "insertions",
      icon: "comment",
      title: txt.btn_reply,
      perform: (e) => e.applySurround("\n[reply]\n", "\n[/reply]\n", txt.txt_reply)
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
      // 使用 span 替代 div，防止破坏 HTML 结构
      const maskNode = document.createElement("span");
      maskNode.className = `secure-content-mask apple-style type-${type}`;
      maskNode.style.display = "flex";
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
      el.style.display = "block";
  }

  api.decorateCookedElement(
    async (element, helper) => {
      try {
        let html = element.innerHTML;
        let hasChanged = false;

        if (/\[login\]|\[reply\]/i.test(html)) {
          // 仅清理多余的换行符，绝不触碰外层的 <p> 标签
          html = html.replace(/(?:<br\s*\/?>)?\s*\[login\]\s*(?:<br\s*\/?>)?/gi, '[login]')
                     .replace(/(?:<br\s*\/?>)?\s*\[\/login\]\s*(?:<br\s*\/?>)?/gi, '[/login]')
                     .replace(/(?:<br\s*\/?>)?\s*\[reply\]\s*(?:<br\s*\/?>)?/gi, '[reply]')
                     .replace(/(?:<br\s*\/?>)?\s*\[\/reply\]\s*(?:<br\s*\/?>)?/gi, '[/reply]');

          // 2. 修复：把外壳换成 <span>，彻底避免被 Callout 内部破坏！
          html = html.replace(/\[login\]([\s\S]*?)\[\/login\]/gim, '<span class="secure-wrapper" data-secure-type="login" style="display:block;">$1</span>')
                     .replace(/\[reply\]([\s\S]*?)\[\/reply\]/gim, '<span class="secure-wrapper" data-secure-type="reply" style="display:block;">$1</span>');
          
          element.innerHTML = html;
          hasChanged = true;
        }

        if (hasChanged && window.applyExternalLinkShield) {
          window.applyExternalLinkShield(element);
        }

        const secureElements = element.querySelectorAll(".secure-wrapper");
        if (!secureElements.length) return;
        
        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.id || helper?.widget?.model?.topic_id || helper?.widget?.model?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

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
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            el.style.display = "block";
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
