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

  // 终极兼容版：通过文本替换 + 动态包裹，避免破坏 Glimmer/Ember 结构
  api.decorateCookedElement(
    async (element, helper) => {
      try {
        let hasChanged = false;
        
        // 我们只在内部通过正则将标签转换，避免使用 Range API 造成的选区错误
        // 同时确保外层用 span 避免 p 标签冲突
        const processHtml = (html) => {
            let tempHtml = html;
            const regexLogin = /\[login\]([\s\S]*?)\[\/login\]/gi;
            const regexReply = /\[reply\]([\s\S]*?)\[\/reply\]/gi;

            if (regexLogin.test(tempHtml)) {
                tempHtml = tempHtml.replace(regexLogin, '<span class="secure-wrapper" data-secure-type="login" style="display:block;width:100%;">$1</span>');
                hasChanged = true;
            }
            if (regexReply.test(tempHtml)) {
                tempHtml = tempHtml.replace(regexReply, '<span class="secure-wrapper" data-secure-type="reply" style="display:block;width:100%;">$1</span>');
                hasChanged = true;
            }
            
            // 清理残留的换行和空标签，防止影响排版
            tempHtml = tempHtml.replace(/<br>\s*<span class="secure-wrapper"/gi, '<span class="secure-wrapper"');
            tempHtml = tempHtml.replace(/<\/span>\s*<br>/gi, '</span>');

            return tempHtml;
        };

        // 如果在 Glimmer 组件 (Callout) 内部，我们需要找到包含文本的最小单位
        // Glimmer 倾向于把内容放在 p 标签或特定的 content div 中
        if (element.classList.contains("callout-content") || element.closest(".callout-content")) {
             // 针对 Callout 组件，我们对其内部的段落进行操作，避免触碰它的外围结构
             const paragraphs = element.querySelectorAll('p');
             if (paragraphs.length > 0) {
                 paragraphs.forEach(p => {
                     const newHtml = processHtml(p.innerHTML);
                     if (p.innerHTML !== newHtml) p.innerHTML = newHtml;
                 });
             } else {
                 // 如果没有 p 标签，直接处理内容
                 const newHtml = processHtml(element.innerHTML);
                 if (element.innerHTML !== newHtml) element.innerHTML = newHtml;
             }
        } else {
            // 普通帖子的处理
            const newHtml = processHtml(element.innerHTML);
            if (element.innerHTML !== newHtml) element.innerHTML = newHtml;
        }

        const secureElements = element.querySelectorAll(".secure-wrapper");
        
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
            // 呼叫护盾插件
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
