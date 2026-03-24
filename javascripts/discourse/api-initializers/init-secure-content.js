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

    if (localStorage.getItem(storageKey) === 'true') return true;
    if (replyStatusCache.has(key)) return replyStatusCache.get(key);
    if (user.post_count === 0) {
        replyStatusCache.set(key, false); return false;
    }

    try {
        const topicController = api.container.lookup('controller:topic');
        if (topicController && topicController.model && topicController.model.id == topicId) {
            if (topicController.model.posted || (topicController.model.get && topicController.model.get('posted'))) {
                localStorage.setItem(storageKey, 'true');
                replyStatusCache.set(key, true);
                return true;
            }
        }
    } catch (e) {}

    if (document.querySelector(`article[data-user-id="${user.id}"]`)) {
        localStorage.setItem(storageKey, 'true');
        replyStatusCache.set(key, true); 
        return true;
    }

    try {
      const searchQuery = `topic:${topicId} user:"${user.username}"`;
      const result = await ajax(`/search.json`, { data: { q: searchQuery } });
      let hasPost = (result && result.posts && result.posts.length > 0);
      if (hasPost) localStorage.setItem(storageKey, 'true');
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
      try { setTimeout(() => window.applyExternalLinkShield(targetNode), 50); } catch (err) {}
    }
  }

  // 【核心机制：气凝胶压缩算法】自底向上的精准裁切，100%不碰组件内核
  function cleanupSpacing(root) {
      if (!root || !root.querySelectorAll) return;
      const selectors = ['p', '.callout-content', '.callout', '.d-quote-callout', 'blockquote', 'div'];
      const containers = root.querySelectorAll(selectors.join(', '));
      const arr = Array.from(containers).reverse();
      
      arr.forEach(el => {
          if (el.classList.contains('secure-content-mask') || el.classList.contains('secure-icon-container')) return;

          let hasVisible = false;
          let hasMask = false;

          el.childNodes.forEach(child => {
              if (child.nodeType === Node.TEXT_NODE) {
                  // 如果文本不是纯空白或零宽字符，算作可见内容
                  if (child.nodeValue.replace(/[\u200B-\u200D\uFEFF\s]/g, '') !== "") {
                      hasVisible = true;
                  }
              } else if (child.nodeType === Node.ELEMENT_NODE) {
                  if (child.style.display === 'none') return; 
                  if (child.classList.contains('secure-empty-p')) return;

                  // 如果子节点是我们上的面具，或者内层已经被判定为仅存面具的壳子
                  if (child.classList.contains('secure-content-mask') || 
                      child.classList.contains('secure-preview-badge') || 
                      child.classList.contains('secure-mask-p')) {
                      hasMask = true;
                  } else if (child.tagName !== 'BR' && 
                             !child.classList.contains('callout-title') && 
                             !child.classList.contains('callout-icon') && 
                             !child.classList.contains('callout-fold') &&
                             !child.classList.contains('secure-hidden-element')) {
                      // 排除掉不影响实际内容的骨架元素，判定是否存在真实的展示内容
                      hasVisible = true;
                  }
              }
          });

          // 如果容器内部没有真实内容了
          if (!hasVisible) {
              if (hasMask) {
                  // 情况 A：只剩面具。直接抽掉这个壳子的 padding 和 margin，让它向内坍缩包裹住面具
                  el.classList.add('secure-mask-p');
                  el.dataset.origMargin = el.style.margin || '';
                  el.dataset.origPadding = el.style.padding || '';
                  el.style.setProperty('margin', '0', 'important');
                  el.style.setProperty('padding', '0', 'important');
                  
                  // 顺手消灭多余的回车符
                  el.childNodes.forEach(child => {
                      if (child.tagName === 'BR' && !child.classList.contains('secure-hidden-element')) {
                          child.classList.add('secure-hidden-element', 'secure-br-hidden');
                          child.dataset.origDisplay = child.style.display || '';
                          child.style.setProperty('display', 'none', 'important');
                      }
                  });
              } else {
                  // 情况 B：彻底空了，连面具也没有。直接隐身。
                  el.classList.add('secure-empty-p');
                  el.dataset.origDisplay = el.style.display || '';
                  el.style.setProperty('display', 'none', 'important');
              }
          }
      });
  }

  function restoreSpacing(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.secure-mask-p').forEach(p => {
          p.classList.remove('secure-mask-p');
          p.style.margin = p.dataset.origMargin || '';
          p.style.padding = p.dataset.origPadding || '';
          if (p.style.length === 0) p.removeAttribute('style');
          
          p.childNodes.forEach(child => {
              if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains('secure-br-hidden')) {
                  child.classList.remove('secure-hidden-element', 'secure-br-hidden');
                  child.style.display = child.dataset.origDisplay || '';
                  if (child.style.length === 0) child.removeAttribute('style');
              }
          });
      });
      root.querySelectorAll('.secure-empty-p').forEach(p => {
          p.classList.remove('secure-empty-p');
          p.style.display = p.dataset.origDisplay || '';
          if (p.style.length === 0) p.removeAttribute('style');
      });
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

            let hiddenTextNodes = [];
            let maskNode = null;

            if (isPreview) {
                maskNode = document.createElement("div");
                maskNode.className = "secure-preview-badge"; 
                maskNode.textContent = txt.preview;
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            } else {
                // 【绝版防护】：不重构 DOM 结构！不插 <span>！只做 CSS 级硬隐身和文本抽空
                topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        n.classList.add('secure-hidden-element');
                        n.dataset.secureOrigDisplay = n.style.display || '';
                        n.style.setProperty('display', 'none', 'important');
                    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue.replace(/[\u200B-\u200D\uFEFF\s]/g, '') !== "") {
                        // 悄悄存下这行文本
                        hiddenTextNodes.push({ textNode: n, origText: n.nodeValue });
                        // 抽干内容，Glimmer 看不出破绽！
                        n.nodeValue = ""; 
                    }
                });

                maskNode = renderMask(type, "lock", txt["mask_" + type]); 
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            }

            lockedBlocks.push({
                type,
                topLevelNodes,
                hiddenTextNodes,
                maskNode,
                isLocked: true
            });
          }
        });

        if (lockedBlocks.length === 0 || isPreview) return;

        // 同步大扫除，一层层抽走因为多级 Callout 和原生 P 标签堆叠产生的空边距
        cleanupSpacing(element);

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

        lockedBlocks.forEach(block => {
            let msgHtml = "";
            let icon = "lock";

            if (block.type === "login") {
                if (currentUser) block.isLocked = false; 
                else { msgHtml = txt.mask_login; icon = "lock"; }
            } else if (block.type === "reply") {
                if (!currentUser) { msgHtml = txt.mask_login_reply; icon = "lock"; }
                else if (hasReplied || currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id) block.isLocked = false;
                else { msgHtml = txt.mask_reply; icon = "reply"; }
            }

            if (block.isLocked) {
                if (block.maskNode) {
                    const textEl = block.maskNode.querySelector('.secure-text');
                    if (textEl) textEl.innerHTML = msgHtml;
                    const iconEl = block.maskNode.querySelector('use');
                    if (iconEl) iconEl.setAttribute('href', '#' + icon);
                }
            } else {
                if (block.maskNode) block.maskNode.remove();

                // 【无损恢复】：将元素解冻复原，不破坏 Glimmer
                block.topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        n.classList.remove('secure-hidden-element');
                        n.style.display = n.dataset.secureOrigDisplay || '';
                        if (n.style.length === 0) n.removeAttribute('style');
                        safeApplyLinkShield(n);
                    }
                });
                // 把抽干的文字塞回去，神不知鬼不觉
                block.hiddenTextNodes.forEach(item => {
                    item.textNode.nodeValue = item.origText;
                });
            }
        });

        // 只要有一块被解锁了，就把没收的 padding/margin 原样奉还
        if (lockedBlocks.some(b => !b.isLocked)) {
             restoreSpacing(element);
        }

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
