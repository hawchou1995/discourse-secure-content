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

  // 1. 完美修复 i18n 失效：深度注入 Discourse Composer 翻译树
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
      // 坚持使用 Span，彻底杜绝违规嵌套
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
      el.style.display = "flex"; // 设置为 Flex 让 UI 不崩溃
  }

  // 2. 核心渲染：原生底层解析，绝对免疫第三方排版污染！
  api.decorateCookedElement(
    async (element, helper) => {
      try {
        if (/\[(login|reply)\]/i.test(element.textContent)) {
            // 第一步：文本节点扫描，只替换标签，绝不触碰 DOM 结构！
            const walkText = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let textNodes = [];
            while(walkText.nextNode()) textNodes.push(walkText.currentNode);
            
            textNodes.forEach(node => {
                let text = node.nodeValue;
                if (/\[(login|reply)\]|\[\/(login|reply)\]/i.test(text)) {
                    let fragment = document.createDocumentFragment();
                    let parts = text.split(/(\[login\]|\[\/login\]|\[reply\]|\[\/reply\])/i);
                    parts.forEach(part => {
                        if (!part) return;
                        let lowerPart = part.toLowerCase();
                        if (lowerPart === '[login]') fragment.appendChild(document.createComment(' SECURE_LOGIN_START '));
                        else if (lowerPart === '[/login]') fragment.appendChild(document.createComment(' SECURE_LOGIN_END '));
                        else if (lowerPart === '[reply]') fragment.appendChild(document.createComment(' SECURE_REPLY_START '));
                        else if (lowerPart === '[/reply]') fragment.appendChild(document.createComment(' SECURE_REPLY_END '));
                        else fragment.appendChild(document.createTextNode(part));
                    });
                    node.parentNode.replaceChild(fragment, node);
                }
            });
            
            // 第二步：利用原生选区 (Range) 精准圈住我们要隐藏的内容，包裹进 span 里
            ['LOGIN', 'REPLY'].forEach(t => {
                let comments = [];
                let walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT, null, false);
                while(walker.nextNode()) comments.push(walker.currentNode);
                
                let startNode = null;
                for (let c of comments) {
                    if (c.nodeValue === ` SECURE_${t}_START `) {
                        startNode = c;
                    } else if (c.nodeValue === ` SECURE_${t}_END ` && startNode) {
                        let endNode = c;
                        let range = document.createRange();
                        range.setStartAfter(startNode);
                        range.setEndBefore(endNode);
                        
                        let contentFragment = range.extractContents();
                        let spanWrapper = document.createElement('span');
                        spanWrapper.className = 'secure-wrapper';
                        spanWrapper.dataset.secureType = t.toLowerCase();
                        spanWrapper.style.display = 'block';
                        spanWrapper.appendChild(contentFragment);
                        
                        range.insertNode(spanWrapper);
                        startNode.remove();
                        endNode.remove();
                        startNode = null;
                    }
                }
            });
            
            // 扫除因剥离产生的空段落
            element.querySelectorAll('p').forEach(p => {
                if (p.innerHTML.trim() === '' || p.innerHTML === '<br>') p.remove();
            });
            
            // 呼叫护盾插件给新生成的 DOM 上色
            if (window.applyExternalLinkShield) {
                window.applyExternalLinkShield(element);
            }
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
