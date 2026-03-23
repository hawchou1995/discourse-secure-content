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
    // 恢复你的原始语法标签
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
      const searchQuery = `topic:${topicId} @${user.username}`;
      const result = await ajax(`/search/query.json`, { data: { q: searchQuery } });
      let hasPost = (result && result.posts && result.posts.length > 0);
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) { return false; }
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

  function safeApplyLinkShield(targetNode) {
    if (typeof window.applyExternalLinkShield === 'function') {
      try {
        setTimeout(() => window.applyExternalLinkShield(targetNode), 50);
      } catch (err) {
        console.warn("[Secure Content] 外链护盾执行异常:", err);
      }
    }
  }

  async function applySecureContent(element, helper) {
      try {
        const contentText = element.textContent;
        if (!contentText || (!contentText.includes("[login]") && !contentText.includes("[reply]"))) return;

        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        if (contentText.includes("[reply]") && currentUser && topicId) {
           hasReplied = await checkUserReplied(currentUser, topicId);
        }

        ["login", "reply"].forEach(type => {
          const startTag = `[${type}]`;
          const endTag = `[/${type}]`;

          let safetyCounter = 0;
          while (safetyCounter++ < 50) { // 防止死循环
            let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let startNode = null;
            let endNode = null;

            // 1. 扫描出纯文本节点里的成对标签
            while (walker.nextNode()) {
              let text = walker.currentNode.nodeValue;
              if (!startNode && text.includes(startTag)) {
                startNode = walker.currentNode;
              }
              if (startNode && walker.currentNode.nodeValue.includes(endTag)) {
                endNode = walker.currentNode;
                break;
              }
            }

            if (!startNode || !endNode) break;

            // 2. 精确从原生节点中切出标记文本，绝不破坏其他 DOM
            let startSplitIndex = startNode.nodeValue.indexOf(startTag);
            let afterStartNode = startNode.splitText(startSplitIndex);
            afterStartNode.nodeValue = afterStartNode.nodeValue.replace(startTag, ""); 

            if (endNode === startNode) endNode = afterStartNode;

            let endSplitIndex = endNode.nodeValue.indexOf(endTag);
            let afterEndNode = endNode.splitText(endSplitIndex);
            afterEndNode.nodeValue = afterEndNode.nodeValue.replace(endTag, "");

            // 3. 权限判定
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

            // 4. 插入你的预览标牌 或 面具节点
            let maskNode = null;
            if (isPreview) {
               maskNode = document.createElement("div");
               maskNode.className = "secure-preview-badge"; // 使用你原有的 CSS 类！
               maskNode.textContent = txt.preview;
            } else if (isLocked) {
               maskNode = renderMask(type, icon, msgHtml);
            }

            if (maskNode) {
               afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            }

            // 5. 将包裹区间内的所有结构静默隐藏（不破坏绑定的 Glimmer）
            if (isLocked && !isPreview) {
                let nodesToHide = [];
                if (afterStartNode === endNode) {
                    nodesToHide.push(endNode);
                } else {
                    let range = document.createRange();
                    range.setStartAfter(afterStartNode);
                    range.setEndBefore(endNode);
                    
                    let container = range.commonAncestorContainer;
                    if (container.nodeType === Node.TEXT_NODE) {
                        nodesToHide.push(endNode);
                    } else {
                        let hideWalker = document.createTreeWalker(container, NodeFilter.SHOW_ALL, null, false);
                        let inRange = false;
                        
                        while (hideWalker.nextNode()) {
                            let node = hideWalker.currentNode;
                            if (node === afterStartNode) {
                                inRange = true; continue;
                            }
                            if (node === endNode) {
                                nodesToHide.push(endNode); break;
                            }
                            if (inRange && !node.contains(endNode)) {
                                if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                                    nodesToHide.push(node);
                                }
                            }
                        }
                    }
                }

                // 去除冗余的嵌套子节点，只隐藏顶层 DOM
                let topLevelNodes = nodesToHide.filter(n => {
                    let p = n.parentNode;
                    while (p) {
                        if (nodesToHide.includes(p)) return false;
                        p = p.parentNode;
                    }
                    return true;
                });

                topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        n.style.display = 'none';
                        n.classList.add('secure-hidden-element');
                    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() !== "") {
                        let span = document.createElement('span');
                        span.style.display = 'none';
                        span.classList.add('secure-hidden-element');
                        n.parentNode.insertBefore(span, n);
                        span.appendChild(n);
                    }
                });
            } else {
               safeApplyLinkShield(element);
            }
          }
        });
      } catch (err) {
        console.error("Secure Content Error:", err);
      }
  }

  // 挂载点
  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);

        // 【大杀器】挂载 MutationObserver：专门捕捉像 Callout 这样延迟/异步渲染的 Glimmer 框架组件
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            for (let m of mutations) {
                for (let i = 0; i < m.addedNodes.length; i++) {
                    let node = m.addedNodes[i];
                    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                        if (node.textContent && (node.textContent.includes("[login]") || node.textContent.includes("[reply]"))) {
                            shouldProcess = true; break;
                        }
                    }
                }
                if (shouldProcess) break;
            }
            if (shouldProcess) applySecureContent(element, helper); // 一旦异步内容渲染完毕，立即回马枪重新上锁！
        });
        observer.observe(element, { childList: true, subtree: true });
    },
    { id: "secure-content-decorator" } 
  );
});
