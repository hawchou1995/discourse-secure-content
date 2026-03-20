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

  // 1. 安全挂载编辑器按钮（再也不会消失了）
  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "insertations",
      icon: "lock",
      title: txt.btn_login,
      perform: (e) => e.applySurround("\n[login]\n", "\n[/login]\n", txt.txt_login)
    });
    toolbar.addButton({
      id: "insert_reply_tag",
      group: "insertations",
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
        replyStatusCache.set(key, false);
        return false;
    }
    if (document.querySelector(`article[data-user-id="${userId}"]`)) {
        replyStatusCache.set(key, true);
        return true;
    }
    try {
      const result = await ajax(`/t/${topicId}.json`);
      let hasPost = result.details?.user_data?.posted || result.details?.participants?.some(p => p.id === userId) || false;
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) {
      return false;
    }
  }

  function renderMask(el, type, icon, msgHtml) {
      const maskDiv = document.createElement("div");
      maskDiv.className = `secure-content-mask apple-style type-${type}`;
      maskDiv.innerHTML = `
          <div class="secure-icon-container">
            <svg class="fa d-icon d-icon-${icon} svg-icon"><use href="#${icon}"></use></svg>
          </div>
          <div class="secure-text">${msgHtml}</div>
       `;

      const replyTrigger = maskDiv.querySelector(".trigger-reply");
      if (replyTrigger) {
        replyTrigger.addEventListener("click", (e) => {
            e.preventDefault();
            const btn = document.querySelector(".topic-footer-main-buttons .create") || document.querySelector(".post-action-menu__reply");
            if (btn) btn.click();
            else window.scrollTo(0, document.body.scrollHeight);
        });
      }
      el.innerHTML = ""; 
      el.appendChild(maskDiv);
      el.style.display = "block";
  }

  // 2. 核心装饰器（暴力替换，无视自动生成的换行）
  api.decorateCookedElement(
    async (element, helper) => {
      try {
        let html = element.innerHTML;
        let hasChanged = false;

        if (/\[login\]|\[reply\]/i.test(html)) {
          // 强力剥离 Discourse 自动加的 P 和 br，杜绝无效隐藏！
          html = html.replace(/<p>\s*\[(login|reply)\]\s*(<br\s*\/?>)?/gi, '[$1]')
                     .replace(/(<br\s*\/?>)?\s*\[\/(login|reply)\]\s*<\/p>/gi, '[/$2]');
                     
          html = html.replace(/\[login\]/gi, '<div class="secure-wrapper" data-secure-type="login">')
                     .replace(/\[\/login\]/gi, '</div>')
                     .replace(/\[reply\]/gi, '<div class="secure-wrapper" data-secure-type="reply">')
                     .replace(/\[\/reply\]/gi, '</div>');
          element.innerHTML = html;
          hasChanged = true;
        }

        // 【关键防御】：如果 innerHTML 发生变化，立刻呼叫护盾插件给所有链接重新打上图标！
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

        // 预览框生效处理
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
            // 解锁后立即请求隔壁护盾给块内的链接加上图标！
            if (window.applyExternalLinkShield) {
               window.applyExternalLinkShield(el);
            }
          }
        });
      } catch (err) {
        console.error("Secure Content Error:", err);
      }
    },
    { id: "secure-content-decorator" } // 移除了 onlyStream 属性，现在不仅在正文，还在 Callout 块和预览中生效！
  );
});
