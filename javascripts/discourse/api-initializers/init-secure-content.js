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
      // 【核心改造】：不再使用 [login]，而是使用官方推荐的 [wrap=login]
      perform: (e) => e.applySurround("\n[wrap=login]\n", "\n[/wrap]\n", "secure_login_text")
    });
    toolbar.addButton({
      id: "insert_reply_tag",
      group: "insertions",
      icon: "comment",
      title: "secure_reply_btn",
      // 【核心改造】：使用 [wrap=reply]
      perform: (e) => e.applySurround("\n[wrap=reply]\n", "\n[/wrap]\n", "secure_reply_text")
    });
  });

  // ==========================================
  // 2. 权限校验逻辑 (不受千人限制的终极方案)
  // ==========================================
  const replyStatusCache = new Map();
  async function checkUserReplied(user, topicId) {
    if (!user || !topicId) return false;
    const key = `${user.id}:${topicId}`;
    
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    
    if (user.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }
    
    if (document.querySelector(`article[data-user-id="${user.id}"]`)) {
        replyStatusCache.set(key, true); return true;
    }
    
    try {
      // 依赖全局搜索接口精准判定，哪怕帖子有上万人回复也不会漏判
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
  // 3. 防御性注入辅助函数 (隔离外链组件崩溃风险)
  // ==========================================
  function safeApplyLinkShield(targetNode) {
    if (typeof window.applyExternalLinkShield === 'function') {
      try {
        setTimeout(() => {
            window.applyExternalLinkShield(targetNode);
        }, 50);
      } catch (err) {
        console.warn("[Secure Content] 外链护盾执行异常，已风险隔离:", err);
      }
    }
  }

  // ==========================================
  // 4. 状态切换核心逻辑
  // ==========================================
  async function applySecureContent(element, helper) {
      try {
        // 【精准匹配】官方自动渲染出的 .d-wrap
        const secureElements = element.querySelectorAll(".d-wrap[data-wrap='login']:not(.processed), .d-wrap[data-wrap='reply']:not(.processed)");
        
        if (!secureElements.length) return;
        
        secureElements.forEach(el => el.classList.add("processed"));

        // 判定预览区
        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        if (isPreview) {
          secureElements.forEach(el => {
              el.classList.add("secure-preview");
              el.setAttribute("data-preview-prefix", txt.preview);
              // 你可能需要配合 CSS:
              // .secure-preview::before { content: attr(data-preview-prefix); display: block; ... }
          });
          safeApplyLinkShield(element);
          return; 
        }

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        // 获取所有包裹的类型，检查是否包含回复可见
        const needsReplyCheck = Array.from(secureElements).some(el => el.dataset.wrap === "reply");
        if (needsReplyCheck && currentUser && topicId) {
           hasReplied = await checkUserReplied(currentUser, topicId);
        }

        secureElements.forEach((el) => {
          const type = el.dataset.wrap; // 会拿到 "login" 或 "reply"
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
            // 解锁状态：展示内容并重新应用外链护盾
            el.classList.add("secure-unlocked");
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
