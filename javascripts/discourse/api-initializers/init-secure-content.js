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

  // 本地事件监听：发帖瞬间打上绝对信任钢印
  api.onAppEvent("post:created", (post) => {
      if (currentUser && post && post.topic_id) {
          localStorage.setItem(`secure_replied_${currentUser.id}:${post.topic_id}`, 'true');
      }
  });

  const replyStatusCache = new Map();
  async function checkUserReplied(user, topicId) {
    if (!user || !topicId) return false;
    const key = `${user.id}:${topicId}`;
    const storageKey = `secure_replied_${key}`;

    // 1. 本地缓存信任
    if (localStorage.getItem(storageKey) === 'true') return true;
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    
    // 2. 总发帖量为 0 过滤
    if (user.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }

    // 3. 【核心更新】读取 Discourse 官方自带的话题参与属性（零延迟，无需网络请求）
    try {
        const topicController = api.container.lookup('controller:topic');
        if (topicController && topicController.model && topicController.model.id == topicId) {
            // posted 属性如果是 true，代表该用户绝对回复过此贴
            if (topicController.model.posted || (topicController.model.get && topicController.model.get('posted'))) {
                localStorage.setItem(storageKey, 'true');
                replyStatusCache.set(key, true);
                return true;
            }
        }
    } catch (e) {}

    // 4. 当前 DOM 内直接扫描
    if (document.querySelector(`article[data-user-id="${user.id}"]`)) {
        localStorage.setItem(storageKey, 'true');
        replyStatusCache.set(key, true); 
        return true;
    }

    // 5. 终极 API 兜底（修复了中文用户名导致 400 崩溃的 Bug）
    try {
      // 放弃容易报错的 @ 语法，改用官方的合法 search.json 和 user:"" 语法
      const searchQuery = `topic:${topicId} user:"${user.username}"`;
      const result = await ajax(`/search.json`, { data: { q: searchQuery } });
      let hasPost = (result && result.posts && result.posts.length > 0);
      if (hasPost) localStorage.setItem(storageKey, 'true');
      replyStatusCache.set(key, hasPost);
      return hasPost;
    } catch (e) { 
      console.warn("[Secure Content] Fallback API check failed:", e);
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
        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        let lockedBlocks = [];

        ["login", "reply"].forEach(type => {
          const startTag = `[${type}]`;
          const endTag = `[/${type}]`;

          let safetyCounter = 0;
          while (safetyCounter++ < 50) { 
            let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let startNode = null;
            let endNode = null;

            while (walker.nextNode()) {
              let text = walker.currentNode.nodeValue;
              if (!startNode && text.includes(startTag)) startNode = walker.currentNode;
              if (startNode && walker.currentNode.nodeValue.includes(endTag)) {
                endNode = walker.currentNode;
                break;
              }
            }

            if (!startNode || !endNode) break;

            let startSplitIndex = startNode.nodeValue.indexOf(startTag);
            let afterStartNode = startNode.splitText(startSplitIndex);
            afterStartNode.nodeValue = afterStartNode.nodeValue.replace(startTag, ""); 

            if (endNode === startNode) endNode = afterStartNode;

            let endSplitIndex = endNode.nodeValue.indexOf(endTag);
            let afterEndNode = endNode.splitText(endSplitIndex);
            afterEndNode.nodeValue = afterEndNode.nodeValue.replace(endTag, "");

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
                        if (node === afterStartNode) { inRange = true; continue; }
                        if (node === endNode) { nodesToHide.push(endNode); break; }
                        if (inRange && !node.contains(endNode)) {
                            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                                nodesToHide.push(node);
                            }
                        }
                    }
                }
            }

            let topLevelNodes = nodesToHide.filter(n => {
                let p = n.parentNode;
                while (p) {
                    if (nodesToHide.includes(p)) return false;
                    p = p.parentNode;
                }
                return true;
            });

            let wrappedTextNodes = [];
            let hiddenWhitespaceNodes = [];
            let maskNode = null;

            if (isPreview) {
                maskNode = document.createElement("div");
                maskNode.className = "secure-preview-badge"; 
                maskNode.textContent = txt.preview;
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            } else {
                // 【第 1 阶段：同步上锁，彻底消灭闪烁】
                topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        n.classList.add('secure-hidden-element');
                    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() !== "") {
                        let span = document.createElement('span');
                        span.classList.add('secure-hidden-element');
                        n.parentNode.insertBefore(span, n);
                        span.appendChild(n);
                        wrappedTextNodes.push({ textNode: n, span: span });
                    }
                });

                maskNode = renderMask(type, "lock", txt["mask_" + type]); 
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);

                let p = maskNode.parentNode;
                if (p && p.tagName === 'P') {
                    let hasRealContent = Array.from(p.childNodes).some(child => {
                         if (child === maskNode) return false;
                         if (child.classList && child.classList.contains('secure-hidden-element')) return false;
                         if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') return true;
                         if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== "") return true;
                         return false;
                    });
                    if (!hasRealContent) p.classList.add('secure-mask-wrapper-p');
                }

                function cleanupWhitespace(node) {
                    if (!node) return;
                    if (node.nodeValue.trim() === "") {
                        if (node.nextSibling && node.nextSibling.tagName === 'BR') {
                            node.nextSibling.classList.add('secure-hidden-element');
                            hiddenWhitespaceNodes.push(node.nextSibling);
                        } else if (node.previousSibling && node.previousSibling.tagName === 'BR') {
                            node.previousSibling.classList.add('secure-hidden-element');
                            hiddenWhitespaceNodes.push(node.previousSibling);
                        }
                    }
                    let parentP = node.parentNode;
                    if (parentP && parentP.tagName === 'P') {
                        let hasContent = Array.from(parentP.childNodes).some(child => {
                            if (child.classList && child.classList.contains('secure-hidden-element')) return false;
                            if (child.classList && (child.classList.contains('secure-content-mask') || child.classList.contains('secure-preview-badge'))) return true;
                            if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') return true;
                            if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== "") return true;
                            return false;
                        });
                        if (!hasContent) {
                            parentP.classList.add('secure-hidden-element');
                            hiddenWhitespaceNodes.push(parentP);
                        }
                    }
                }

                cleanupWhitespace(afterStartNode);
                cleanupWhitespace(afterEndNode);
            }

            lockedBlocks.push({
                type,
                topLevelNodes,
                wrappedTextNodes,
                hiddenWhitespaceNodes,
                maskNode
            });
          }
        });

        if (lockedBlocks.length === 0 || isPreview) return;

        // 【第 2 阶段：发起鉴权】
        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        const needsReplyCheck = lockedBlocks.some(b => b.type === "reply");
        if (needsReplyCheck && currentUser && topicId) {
            hasReplied = await checkUserReplied(currentUser, topicId);
        }

        // 【第 3 阶段：基于权限解锁与恢复】
        lockedBlocks.forEach(block => {
            let isLocked = true;
            let msgHtml = "";
            let icon = "lock";

            if (block.type === "login") {
                if (currentUser) isLocked = false; 
                else { msgHtml = txt.mask_login; icon = "lock"; }
            } else if (block.type === "reply") {
                if (!currentUser) { msgHtml = txt.mask_login_reply; icon = "lock"; }
                else if (hasReplied || currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id) isLocked = false;
                else { msgHtml = txt.mask_reply; icon = "reply"; }
            }

            if (isLocked) {
                if (block.maskNode) {
                    const textEl = block.maskNode.querySelector('.secure-text');
                    if (textEl) textEl.innerHTML = msgHtml;
                    const iconEl = block.maskNode.querySelector('use');
                    if (iconEl) iconEl.setAttribute('href', '#' + icon);
                }
            } else {
                if (block.maskNode) {
                    let p = block.maskNode.parentNode;
                    block.maskNode.remove();
                    if (p && p.tagName === 'P') p.classList.remove('secure-mask-wrapper-p');
                }

                block.topLevelNodes.forEach(n => n.nodeType === Node.ELEMENT_NODE && n.classList.remove('secure-hidden-element'));
                block.wrappedTextNodes.forEach(item => {
                    if (item.span && item.span.parentNode) {
                        item.span.parentNode.insertBefore(item.textNode, item.span);
                        item.span.remove();
                    }
                });
                block.hiddenWhitespaceNodes.forEach(n => n.classList.remove('secure-hidden-element'));
                block.topLevelNodes.forEach(n => n.nodeType === Node.ELEMENT_NODE && safeApplyLinkShield(n));
            }
        });

      } catch (err) {
        console.error("Secure Content Error:", err);
      }
  }

  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);

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
            if (shouldProcess) applySecureContent(element, helper); 
        });
        observer.observe(element, { childList: true, subtree: true });
    },
    { id: "secure-content-decorator" } 
  );
});
