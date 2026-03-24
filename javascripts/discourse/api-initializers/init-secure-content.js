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
      try {
        setTimeout(() => window.applyExternalLinkShield(targetNode), 50);
      } catch (err) { }
    }
  }

  // 靶向收缩相邻空行
  function hideAdjacentBr(node, hiddenList) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() === "") {
          if (node.nextSibling && node.nextSibling.tagName === 'BR') {
              node.nextSibling.classList.add('secure-hidden-element');
              hiddenList.push(node.nextSibling);
          } else if (node.previousSibling && node.previousSibling.tagName === 'BR') {
              node.previousSibling.classList.add('secure-hidden-element');
              hiddenList.push(node.previousSibling);
          }
      }
  }

  // 【核心新增】外科手术级的空壳修剪器。从里向外靶向切除因隐藏内容而留下的空架子
  function hideIfEmpty(el, hiddenList, rootElement) {
      if (!el || el === rootElement || el === document.body) return;
      
      // 如果当前容器包含我们插入的面具，那是绝对不能隐藏的，必须留着给用户看
      if (el.querySelector('.secure-content-mask') || el.classList.contains('secure-content-mask')) return;
      if (el.querySelector('.secure-preview-badge') || el.classList.contains('secure-preview-badge')) return;

      let hasVisible = Array.from(el.childNodes).some(child => {
          if (child.nodeType === Node.ELEMENT_NODE) {
              if (child.classList.contains('secure-hidden-element')) return false;
              if (child.tagName === 'BR') return false;
              // Callout 的外壳配件不能算作正文
              if (child.classList.contains('callout-title') || child.classList.contains('callout-icon') || child.classList.contains('callout-fold')) return false;
              return true;
          }
          if (child.nodeType === Node.TEXT_NODE) {
              return child.nodeValue.trim() !== "";
          }
          return false;
      });

      // 如果这个容器空了，切掉它，然后继续往外层追溯！(完美解决多层嵌套空行)
      if (!hasVisible) {
          el.classList.add('secure-hidden-element');
          hiddenList.push(el);
          hideIfEmpty(el.parentNode, hiddenList, rootElement);
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
            let maskParentP = null;

            if (isPreview) {
                maskNode = document.createElement("div");
                maskNode.className = "secure-preview-badge"; 
                maskNode.textContent = txt.preview;
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            } else {
                // 第 1 步：优先安插遮罩
                maskNode = renderMask(type, "lock", txt["mask_" + type]); 
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);

                // 第 2 步：将原本应锁死的内容隐藏
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

                // 第 3 步：强制清除面具自带的段落上下边距，这是扼杀大部分缝隙的关键
                maskParentP = maskNode.parentNode;
                if (maskParentP && maskParentP.tagName === 'P') {
                    maskParentP.style.setProperty('margin-bottom', '0', 'important');
                    maskParentP.style.setProperty('margin-top', '0', 'important');
                }

                // 第 4 步：靶向清除因内容隐藏而暴露的孤立空行和多层 Callout 空壳
                hideAdjacentBr(afterStartNode, hiddenWhitespaceNodes);
                hideAdjacentBr(afterEndNode, hiddenWhitespaceNodes);
                hideIfEmpty(afterStartNode.parentNode, hiddenWhitespaceNodes, element);
                hideIfEmpty(afterEndNode.parentNode, hiddenWhitespaceNodes, element);
            }

            lockedBlocks.push({
                type,
                topLevelNodes,
                wrappedTextNodes,
                hiddenWhitespaceNodes,
                maskNode,
                maskParentP
            });
          }
        });

        if (lockedBlocks.length === 0 || isPreview) return;

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

        // 最终阶段：依据权限，原封不动地解禁
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
                if (block.maskNode) block.maskNode.remove();
                if (block.maskParentP) {
                    block.maskParentP.style.removeProperty('margin-bottom');
                    block.maskParentP.style.removeProperty('margin-top');
                }

                block.topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) n.classList.remove('secure-hidden-element');
                });
                block.wrappedTextNodes.forEach(item => {
                    if (item.span && item.span.parentNode) {
                        item.span.parentNode.insertBefore(item.textNode, item.span);
                        item.span.remove();
                    }
                });
                
                // 将被作为空壳收容的所有的 P 标签、多级 Callout 边框，瞬间解禁恢复！
                block.hiddenWhitespaceNodes.forEach(n => {
                    n.classList.remove('secure-hidden-element');
                });
                
                block.topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) safeApplyLinkShield(n);
                });
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
