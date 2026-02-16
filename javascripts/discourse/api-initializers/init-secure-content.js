import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("0.11", (api) => {
  const currentUser = api.getCurrentUser();

  // =========================================================
  // 1. 独立的多语言字典 (回归最稳健的 JS 原生字典模式)
  // =========================================================
  const STRINGS = {
    zh_CN: {
      btn_login_title: "插入登录可见块",
      btn_reply_title: "插入回复可见块",
      raw_login_text: "此处内容登录后可见...",
      raw_reply_text: "此处内容回复后可见...",
      mask_login: `此内容仅供登录用户查看，请 <a href="/login" class="secure-link-btn">登录</a>`,
      mask_reply: `此内容隐藏，请 <a href="#" class="secure-link-btn trigger-reply">回复本帖</a> 后查看`,
      mask_login_reply: `此内容需回复可见，请先 <a href="/login" class="secure-link-btn">登录</a>`,
      preview_prefix: "🔒 隐藏内容预览",
    },
    en: {
      btn_login_title: "Insert Login-only Block",
      btn_reply_title: "Insert Reply-only Block",
      raw_login_text: "Content visible after login...",
      raw_reply_text: "Content visible after reply...",
      mask_login: `Content hidden. Please <a href="/login" class="secure-link-btn">Log In</a> to view.`,
      mask_reply: `Content hidden. Please <a href="#" class="secure-link-btn trigger-reply">Reply</a> to view.`,
      mask_login_reply: `Reply required. Please <a href="/login" class="secure-link-btn">Log In</a> first.`,
      preview_prefix: "🔒 Hidden Content Preview",
    }
  };

  const locale = I18n.currentLocale(); 
  const langKey = locale.startsWith("zh") ? "zh_CN" : "en";
  const R = STRINGS[langKey] || STRINGS["en"];

  // =========================================================
  // 2. 注入 Discourse 翻译系统 (双重挂载，完美兼容工具栏与编辑器)
  // =========================================================
  if (!I18n.translations[locale]) I18n.translations[locale] = {};
  if (!I18n.translations[locale].js) I18n.translations[locale].js = {};
  if (!I18n.translations[locale].js.composer) I18n.translations[locale].js.composer = {};
  
  const KEY_LOGIN_BTN = "secure_login_btn_title";
  const KEY_REPLY_BTN = "secure_reply_btn_title";
  const KEY_LOGIN_TEXT = "secure_login_default_text"; 
  const KEY_REPLY_TEXT = "secure_reply_default_text"; 

  // 工具栏按钮 title 需要读取 js 根目录
  I18n.translations[locale].js[KEY_LOGIN_BTN] = R.btn_login_title;
  I18n.translations[locale].js[KEY_REPLY_BTN] = R.btn_reply_title;
  
  // 编辑器 applySurround 强制读取 js.composer 目录
  I18n.translations[locale].js.composer[KEY_LOGIN_TEXT] = R.raw_login_text;
  I18n.translations[locale].js.composer[KEY_REPLY_TEXT] = R.raw_reply_text;

  // =========================================================
  // 3. 深度清理函数
  // =========================================================
  function cleanInnerHtml(html) {
    if (!html) return "";
    let c = html;
    c = c.replace(/^(\s*<br\s*\/?>\s*|\s*<p>\s*|\s+)+/gi, "");
    c = c.replace(/(\s*<br\s*\/?>\s*|\s*<\/p>\s*|\s+)+$/gi, "");
    return c;
  }

  // =========================================================
  // 4. 编辑器按钮逻辑
  // =========================================================
  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      id: "insert_login_tag",
      group: "extras",
      icon: "lock",
      title: KEY_LOGIN_BTN, 
      perform: (e) => {
        e.applySurround("\n[login]\n", "\n[/login]\n", KEY_LOGIN_TEXT);
      },
    });

    toolbar.addButton({
      id: "insert_reply_tag",
      group: "extras",
      icon: "comment", 
      title: KEY_REPLY_BTN, 
      perform: (e) => {
        e.applySurround("\n[reply]\n", "\n[/reply]\n", KEY_REPLY_TEXT);
      },
    });
  });

  // =========================================================
  // 5. 核心渲染逻辑
  // =========================================================
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

      // 预览模式逻辑
      if (!topicId && !document.body.classList.contains("topic-page")) {
        secureElements.forEach(el => {
            el.classList.add("secure-preview");
            el.setAttribute("data-preview-prefix", R.preview_prefix);
        });
        return; 
      }

      // --- 权限检查 ---
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

      // --- 渲染遮罩 ---
      secureElements.forEach((el) => {
        const type = el.dataset.secureType;
        let isLocked = true;
        let msgHtml = "";
        let icon = "lock";

        if (type === "login") {
          if (currentUser) {
            isLocked = false; 
          } else {
            msgHtml = R.mask_login;
            icon = "lock";
          }
        } else if (type === "reply") {
          if (!currentUser) {
             msgHtml = R.mask_login_reply;
             icon = "lock"; 
          } else if (hasReplied || currentUser.admin || currentUser.moderator) {
            isLocked = false;
          } else {
            msgHtml = R.mask_reply;
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
