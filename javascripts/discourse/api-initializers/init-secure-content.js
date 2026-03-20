import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();
  const locale = window.I18n ? window.I18n.currentLocale() : "zh_CN";
  const lang = locale.startsWith("zh") ? "zh" : "en";

  // 国际化文案
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

  // 1. 完美修复 i18n 失效：直接把文案强制注射进 Discourse 的翻译库
  const loginBtnKey = themePrefix("insert_login");
  const replyBtnKey = themePrefix("insert_reply");
  if (window.I18n && window.I18n.translations && window.I18n.translations[locale]) {
     let js = window.I18n.translations[locale].js || {};
     js[loginBtnKey] = txt.btn_login;
     js[replyBtnKey] = txt.btn_reply;
     window.I18n.translations[locale].js = js;
  }

  // 注册按钮（绝对不会消失，且多语言悬浮提示正常）
  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "insertions", // 修复了上次写错的组名
      icon: "lock",
      title: loginBtnKey,
      perform: (e) => e.applySurround("\n[login]\n", "\n[/login]\n", txt.txt_login)
    });
    toolbar.addButton({
      id: "insert_reply_tag",
      group: "insertions",
      icon: "comment",
      title: replyBtnKey,
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
      const maskNode = document.createElement("div");
      maskNode.className = `secure-content-mask apple-style type-${type}`;
      maskNode.innerHTML = `
          <div class="secure-icon-container">
            <svg class="fa d-icon d-icon-${icon} svg-icon"><use href="#${icon}"></use></svg>
          </div>
          <div class="secure-text">${msgHtml}</div>
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
          // 2. 降维打击修复裸露BUG：强行打破 P 标签，确保 div 永远是最高级块元素
          html = html.replace(/\[login\]/gi, '</p><div class="secure-wrapper" data-secure-type="login"><p>')
                     .replace(/\[\/login\]/gi, '</p></div><p>')
                     .replace(/\[reply\]/gi, '</p><div class="secure-wrapper" data-secure-type="reply"><p>')
                     .replace(/\[\/reply\]/gi, '</p></div><p>');
          
          // 清除因为暴力打破而产生的空 P 标签和空 br
          html = html.replace(/<p>(\s|<br\s*\/?>)*<\/p>/gi, '');
          
          element.innerHTML = html;
          hasChanged = true;
        }

        const secureElements = element.querySelectorAll(".secure-wrapper");
        
        // 如果没有隐藏块，但是有替换发生，说明内容需要护盾接管
        if (!secureElements.length) {
            if (hasChanged && window.applyExternalLinkShield) {
                window.applyExternalLinkShield(element);
            }
            return;
        }

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
            // 解锁
            el.classList.remove("secure-wrapper");
            el.classList.add("secure-unlocked");
            el.style.display = "block";
            // 呼叫护盾插件给内容补上图标
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
