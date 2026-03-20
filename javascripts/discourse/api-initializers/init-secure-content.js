import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();

  const STRINGS = {
    zh_CN: {
      mask_login: `此内容仅供登录用户查看，请 <a href="/login" class="secure-link-btn">登录</a>`,
      mask_reply: `此内容隐藏，请 <a href="#" class="secure-link-btn trigger-reply">回复本帖</a> 后查看`,
      mask_login_reply: `此内容需回复可见，请先 <a href="/login" class="secure-link-btn">登录</a>`,
      preview_prefix: "🔒 隐藏内容预览",
    },
    en: {
      mask_login: `Content hidden. Please <a href="/login" class="secure-link-btn">Log In</a> to view.`,
      mask_reply: `Content hidden. Please <a href="#" class="secure-link-btn trigger-reply">Reply</a> to view.`,
      mask_login_reply: `Reply required. Please <a href="/login" class="secure-link-btn">Log In</a> first.`,
      preview_prefix: "🔒 Hidden Content Preview",
    }
  };

  const getLocText = (key) => {
    const lang = window.I18n ? window.I18n.currentLocale() : "zh_CN";
    const map = lang.startsWith("zh") ? STRINGS.zh_CN : STRINGS.en;
    return map[key];
  };

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
      let hasPost = false;
      if (result.details && result.details.user_data && typeof result.details.user_data.posted === 'boolean') {
          hasPost = result.details.user_data.posted;
      } else {
          hasPost = result.details && result.details.participants && result.details.participants.some(p => p.id === userId);
      }
      replyStatusCache.set(key, !!hasPost);
      return !!hasPost;
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
            const selectors = [
                ".topic-footer-main-buttons .create", 
                ".post-action-menu__reply",
                "#topic-footer-buttons .btn-primary"
            ];
            let btn = null;
            for (const sel of selectors) {
                btn = document.querySelector(sel);
                if (btn) break;
            }
            if (btn) btn.click();
            else window.scrollTo(0, document.body.scrollHeight);
        });
      }
      
      el.innerHTML = ""; 
      el.appendChild(maskDiv);
      el.style.display = "block";
  }

  api.decorateCookedElement(
    async (element, helper) => {
      try {
        let html = element.innerHTML;
        let hasChanged = false;

        // 【终极防弹正则】无视任何 <p> 和 <br> 标签干扰
        if (/\[login\]/i.test(html)) {
          html = html.replace(
             /(?:<p>)?\s*\[login\]\s*(?:<br\s*\/?>)?\s*(?:<\/p>)?([\s\S]*?)(?:<p>)?\s*(?:<br\s*\/?>)?\s*\[\/login\]\s*(?:<\/p>)?/gim, 
             '<div class="secure-wrapper" data-secure-type="login">$1</div>'
          );
          hasChanged = true;
        }

        if (/\[reply\]/i.test(html)) {
          html = html.replace(
             /(?:<p>)?\s*\[reply\]\s*(?:<br\s*\/?>)?\s*(?:<\/p>)?([\s\S]*?)(?:<p>)?\s*(?:<br\s*\/?>)?\s*\[\/reply\]\s*(?:<\/p>)?/gim, 
             '<div class="secure-wrapper" data-secure-type="reply">$1</div>'
          );
          hasChanged = true;
        }

        if (hasChanged) {
          element.innerHTML = html;
        }

        const secureElements = element.querySelectorAll(".secure-wrapper");
        if (!secureElements.length) return;
        
        let topicId = null;
        if (helper && helper.getModel && helper.getModel()) {
            topicId = helper.getModel().topic_id || helper.getModel().id;
        } else if (helper && helper.widget && helper.widget.model) {
            topicId = helper.widget.model.topic_id || helper.widget.model.id;
        }
        
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        // 预览模式
        if (!topicId && !document.body.classList.contains("topic-page")) {
          secureElements.forEach(el => {
              el.classList.add("secure-preview");
              el.setAttribute("data-preview-prefix", getLocText("preview_prefix"));
              el.style.display = "block";
          });
          // 手动为预览内容召唤护盾
          if (window.applyExternalLinkShield) window.applyExternalLinkShield(element);
          return; 
        }

        let hasReplied = false;
        let replyCheckPromise = Promise.resolve(false);
        const needsReplyCheck = Array.from(secureElements).some(el => el.dataset.secureType === "reply");

        if (needsReplyCheck && currentUser && topicId) {
           replyCheckPromise = checkUserReplied(currentUser.id, topicId);
        }

        hasReplied = await replyCheckPromise;

        secureElements.forEach((el) => {
          const type = el.dataset.secureType;
          let isLocked = true;
          let msgHtml = "";
          let icon = "lock";

          if (type === "login") {
            if (currentUser) isLocked = false; 
            else { msgHtml = getLocText("mask_login"); icon = "lock"; }
          } else if (type === "reply") {
            if (!currentUser) { msgHtml = getLocText("mask_login_reply"); icon = "lock"; }
            else if (hasReplied || currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel()?.user_id) isLocked = false;
            else { msgHtml = getLocText("mask_reply"); icon = "reply"; }
          }

          if (isLocked) {
            renderMask(el, type, icon, msgHtml);
          } else {
            // 已解锁：展示内容并重新召唤外部链接护盾
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            el.style.display = "block";
            if (window.applyExternalLinkShield) {
               window.applyExternalLinkShield(el);
            }
          }
        });
      } catch (err) {
        console.error("[Secure Content] Rendering error:", err);
      }
    },
    { id: "secure-content-decorator", onlyStream: true }
  );
});
