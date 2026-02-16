import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import I18n from "I18n";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();

  // 1. 深度清理函数
  function cleanInnerHtml(html) {
    if (!html) return "";
    let c = html;
    c = c.replace(/^(\s*<br\s*\/?>\s*|\s*<p>\s*|\s+)+/gi, "");
    c = c.replace(/(\s*<br\s*\/?>\s*|\s*<\/p>\s*|\s+)+$/gi, "");
    return c;
  }

  // 2. 编辑器按钮
  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "extras",
      icon: "lock",
      title: "secure_login_btn_title", 
      perform: (e) => {
        e.applySurround("\n[login]\n", "\n[/login]\n", "secure_login_default_text");
      },
    });

    toolbar.addButton({
      id: "insert_reply_tag",
      group: "extras",
      icon: "comment", 
      title: "secure_reply_btn_title", 
      perform: (e) => {
        e.applySurround("\n[reply]\n", "\n[/reply]\n", "secure_reply_default_text");
      },
    });
  });

  // 3. 核心渲染逻辑
  api.decorateCookedElement(
    async (element, helper) => {
      let html = element.innerHTML;
      let hasChanged = false;

      if (/\[login\]/i.test(html)) {
        html = html.replace(
           /\[login\]([\s\S]*?)\[\/login\]/gim, 
           (m, p1) => `<div class="secure-wrapper" data-secure-type="login">${cleanInnerHtml(p1)}</div>`
        );
        hasChanged = true;
      }

      if (/\[reply\]/i.test(html)) {
        html = html.replace(
           /\[reply\]([\s\S]*?)\[\/reply\]/gim, 
           (m, p1) => `<div class="secure-wrapper" data-secure-type="reply">${cleanInnerHtml(p1)}</div>`
        );
        hasChanged = true;
      }

      if (hasChanged) element.innerHTML = html;

      const secureElements = element.querySelectorAll(".secure-wrapper");
      if (!secureElements.length) return;

      const topicId = helper ? helper.getModel()?.topic_id : null;

      // 预览模式
      if (!topicId && !document.body.classList.contains("topic-page")) {
        secureElements.forEach(el => {
            el.classList.add("secure-preview");
            el.setAttribute("data-preview-prefix", I18n.t("secure_preview_prefix"));
        });
        return; 
      }

      // 权限检查
      let hasReplied = false;
      let replyCheckPromise = null;
      const needsReplyCheck = Array.from(secureElements).some(el => el.dataset.secureType === "reply");

      if (currentUser && topicId && needsReplyCheck) {
         replyCheckPromise = checkUserReplied(currentUser.id, topicId);
      } else {
         replyCheckPromise = Promise.resolve(false);
      }

      if (needsReplyCheck && currentUser) {
         hasReplied = await replyCheckPromise;
      }

      // 渲染遮罩
      secureElements.forEach((el) => {
        const type = el.dataset.secureType;
        let isLocked = true;
        let msgHtml = "";
        let icon = "lock";

        if (type === "login") {
          if (currentUser) {
            isLocked = false; 
          } else {
            msgHtml = I18n.t("secure_mask_login");
            icon = "lock";
          }
        } else if (type === "reply") {
          if (!currentUser) {
             msgHtml = I18n.t("secure_mask_login_reply");
             icon = "lock"; 
          } else if (hasReplied || currentUser.admin || currentUser.moderator) {
            isLocked = false;
          } else {
            msgHtml = I18n.t("secure_mask_reply");
            icon = "reply"; 
          }
        }

        if (isLocked) {
          renderMask(el, type, icon, msgHtml);
        } else {
          unlockContent(el);
        }
      });
    },
    { id: "secure-content-decorator" }
  );

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

  function unlockContent(el) {
      el.classList.remove("secure-wrapper");
      el.classList.add("secure-unlocked");
      el.style.display = "block";
  }

  const replyStatusCache = new Map();
  async function checkUserReplied(userId, topicId) {
    const key = `${userId}:${topicId}`;
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    
    const user = api.getCurrentUser();
    if (user && user.post_count === 0) {
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
      if (result.details && typeof result.details.current_user_posted === 'boolean') {
          hasPost = result.details.current_user_posted;
      } else {
          hasPost = result.details?.participants?.some(p => p.id === userId);
      }
      replyStatusCache.set(key, !!hasPost);
      return !!hasPost;
    } catch (e) {
      return false;
    }
  }
});
