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

  // 【核心黑科技】靶向清理因锁定产生的多余留白（段落、换行、多级Callout框架）
  function cleanupSpacingForMask(maskNode, block) {
      let parent = maskNode.parentNode;
      block.modifiedParents = [];
      block.hiddenBrs = [];

      while (parent && parent.nodeType === Node.ELEMENT_NODE && parent !== document.body) {
          if (parent.tagName === 'P' || parent.classList.contains('callout-content') || parent.classList.contains('callout') || parent.tagName === 'BLOCKQUOTE') {
              let hasVisible = Array.from(parent.childNodes).some(child => {
                  if (child.nodeType === Node.TEXT_NODE) {
                      return child.nodeValue.replace(/[\u200B-\u200D\uFEFF\s]/g, '') !== "";
                  } else if (child.nodeType === Node.ELEMENT_NODE) {
                      if (child.style.display === 'none') return false;
                      if (child.classList.contains('secure-content-mask')) return false;
                      if (child.classList.contains('secure-preview-badge')) return false;
                      if (child.classList.contains('callout-title')) return false; 
                      if (child.tagName === 'BR') return false; 
                      return true;
                  }
                  return false;
              });

              if (!hasVisible) {
                  block.modifiedParents.push({
                      el: parent,
                      origMargin: parent.style.margin || '',
                      origPadding: parent.style.padding || ''
                  });
                  parent.classList.add('secure-mask-p');
                  parent.style.setProperty('margin', '0', 'important');
                  parent.style.setProperty('padding', '0', 'important');
                  
                  Array.from(parent.childNodes).forEach(child => {
                      if (child.tagName === 'BR' && child.style.display !== 'none') {
                          block.hiddenBrs.push({
                              el: child,
                              origDisplay: child.style.display || ''
                          });
                          child.style.setProperty('display', 'none', 'important');
                      }
                  });
              }
          }
          parent = parent.parentNode;
      }
  }

  async function applySecureContent(element, helper) {
      try {
        if (!element.textContent.includes('[login]') && !element.textContent.includes('[reply]')) return;

        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        let lockedBlocks = [];

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        if (currentUser && topicId && element.textContent.includes('[reply]')) {
            hasReplied = await checkUserReplied(currentUser, topicId);
        }

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
                        // 致命修正：必须把包含紧贴标签的换行节点也囊括进隐藏范围！
                        if (node === afterStartNode) { 
                            inRange = true; 
                            nodesToHide.push(node);
                            continue; 
                        }
                        if (node === endNode) { 
                            nodesToHide.push(node); 
                            break; 
                        }
                        if (inRange && !node.contains(endNode)) {
                            nodesToHide.push(node);
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

            let maskNode = null;

            if (isPreview) {
                maskNode = document.createElement("div");
                maskNode.className = "secure-preview-badge"; 
                maskNode.textContent = txt.preview;
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
            } else if (isLocked) {
                maskNode = renderMask(type, icon, msgHtml);
                afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);

                topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        if (n.dataset.secureOrigDisplay === undefined) {
                            n.dataset.secureOrigDisplay = n.style.display || '';
                        }
                        n.classList.add('secure-hidden-element');
                        n.style.setProperty('display', 'none', 'important');
                    } else if (n.nodeType === Node.TEXT_NODE) {
                        // 零侵入 DOM 隐藏法，防止 Glimmer 报错
                        if (n.originalText === undefined) {
                            n.originalText = n.nodeValue;
                        }
                        n.nodeValue = "";
                    }
                });
            }

            lockedBlocks.push({
                isLocked: isLocked && !isPreview,
                maskNode,
                topLevelNodes
            });
          }
        });

        // 大扫除与权限解锁恢复
        lockedBlocks.forEach(block => {
            if (block.isLocked) {
                cleanupSpacingForMask(block.maskNode, block);
            } else {
                if (block.maskNode) block.maskNode.remove();
                block.topLevelNodes.forEach(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        n.classList.remove('secure-hidden-element');
                        n.style.display = n.dataset.secureOrigDisplay || '';
                        if (n.style.length === 0) n.removeAttribute('style');
                        safeApplyLinkShield(n);
                    } else if (n.nodeType === Node.TEXT_NODE) {
                        if (n.originalText !== undefined) {
                            n.nodeValue = n.originalText;
                        }
                    }
                });

                if (block.modifiedParents) {
                    block.modifiedParents.forEach(p => {
                        p.el.classList.remove('secure-mask-p');
                        p.el.style.margin = p.origMargin;
                        p.el.style.padding = p.origPadding;
                        if (p.el.style.length === 0) p.el.removeAttribute('style');
                    });
                }
                if (block.hiddenBrs) {
                    block.hiddenBrs.forEach(br => {
                        br.el.style.display = br.origDisplay;
                        if (br.el.style.length === 0) br.el.removeAttribute('style');
                    });
                }
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
