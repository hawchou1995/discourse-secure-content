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

  // 绝杀连带换行符
  function killAdjacentBr(textNode, direction) {
      let curr = direction === 'next' ? textNode.nextSibling : textNode.previousSibling;
      while (curr) {
          if (curr.nodeType === Node.TEXT_NODE && curr.nodeValue.replace(/[\u200B-\u200D\uFEFF\s]/g, '') === "") {
              curr = direction === 'next' ? curr.nextSibling : curr.previousSibling;
          } else if (curr.nodeType === Node.ELEMENT_NODE && curr.tagName === 'BR') {
              curr.style.display = 'none';
              curr.classList.add('secure-tag-artifact');
              break; 
          } else {
              break;
          }
      }
  }

  // 绝杀空P标签
  function hideEmptyP(textNode) {
      let p = textNode.parentNode;
      if (p && p.tagName === 'P') {
          let hasVisible = Array.from(p.childNodes).some(child => {
              if (child.nodeType === Node.TEXT_NODE) return child.nodeValue.replace(/[\u200B-\u200D\uFEFF\s]/g, '') !== "";
              if (child.nodeType === Node.ELEMENT_NODE) {
                  if (child.style.display === 'none' || child.classList.contains('secure-tag-artifact')) return false;
                  return true;
              }
              return false;
          });
          if (!hasVisible) {
              p.style.display = 'none';
              p.classList.add('secure-tag-artifact');
          }
      }
  }

  // 面具骨架边距收缩
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
                      if (child.classList.contains('secure-content-mask') || child.classList.contains('secure-preview-badge') || child.classList.contains('secure-tag-artifact')) return false;
                      if (child.classList.contains('callout-title') || child.classList.contains('callout-icon') || child.classList.contains('callout-fold')) return false; 
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
                          block.hiddenBrs.push({ el: child, origDisplay: child.style.display || '' });
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
        const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
        
        // 只在第一次解析时抽空标签结构
        if (!element._secureBlocks) {
            element._secureBlocks = [];
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

                    // 斩草除根：直接抹杀标签带来的换行和空白框！
                    killAdjacentBr(afterStartNode, 'next');
                    hideEmptyP(afterStartNode);
                    killAdjacentBr(afterEndNode, 'previous');
                    hideEmptyP(afterEndNode);

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
                                if (node === endNode) { nodesToHide.push(node); break; }
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

                    element._secureBlocks.push({
                        type,
                        topLevelNodes,
                        afterStartNode,
                        isLocked: null 
                    });
                }
            });
        }

        if (element._secureBlocks.length === 0) return;

        let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
        if (!topicId) {
            const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
            if (match) topicId = match[1];
        }

        let hasReplied = false;
        const needsReplyCheck = element._secureBlocks.some(b => b.type === "reply");
        if (needsReplyCheck && currentUser && topicId) {
            hasReplied = await checkUserReplied(currentUser, topicId);
        }

        element._secureBlocks.forEach(block => {
            let shouldBeLocked = true;
            let msgHtml = "";
            let icon = "lock";

            if (block.type === "login") {
                if (currentUser) shouldBeLocked = false; 
                else { msgHtml = txt.mask_login; icon = "lock"; }
            } else if (block.type === "reply") {
                if (!currentUser) { msgHtml = txt.mask_login_reply; icon = "lock"; }
                else if (hasReplied || currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id) shouldBeLocked = false;
                else { msgHtml = txt.mask_reply; icon = "reply"; }
            }

            if (isPreview) {
                if (!block.maskNode) {
                    block.maskNode = document.createElement("div");
                    block.maskNode.className = "secure-preview-badge"; 
                    block.maskNode.textContent = txt.preview;
                    let insertRef = block.afterStartNode;
                    if (insertRef.parentNode.tagName === 'P' && insertRef.parentNode.classList.contains('secure-tag-artifact')) {
                        insertRef = insertRef.parentNode;
                    }
                    insertRef.parentNode.insertBefore(block.maskNode, insertRef);
                }
                return;
            }

            if (shouldBeLocked !== block.isLocked) {
                block.isLocked = shouldBeLocked;
                
                if (shouldBeLocked) {
                    block.maskNode = renderMask(block.type, icon, msgHtml);
                    let insertRef = block.afterStartNode;
                    if (insertRef.parentNode.tagName === 'P' && insertRef.parentNode.classList.contains('secure-tag-artifact')) {
                        insertRef = insertRef.parentNode;
                    }
                    insertRef.parentNode.insertBefore(block.maskNode, insertRef);

                    block.topLevelNodes.forEach(n => {
                        if (n.nodeType === Node.ELEMENT_NODE) {
                            if (n.dataset.secureOrigDisplay === undefined) {
                                n.dataset.secureOrigDisplay = n.style.display || '';
                            }
                            n.classList.add('secure-hidden-element');
                            n.style.setProperty('display', 'none', 'important');
                        } else if (n.nodeType === Node.TEXT_NODE) {
                            if (n.originalText === undefined) {
                                n.originalText = n.nodeValue;
                            }
                            n.nodeValue = "";
                        }
                    });

                    cleanupSpacingForMask(block.maskNode, block);
                } else {
                    if (block.maskNode) {
                        block.maskNode.remove();
                        block.maskNode = null;
                    }

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
                        block.modifiedParents = [];
                    }
                    if (block.hiddenBrs) {
                        block.hiddenBrs.forEach(br => {
                            br.el.style.display = br.origDisplay;
                            if (br.el.style.length === 0) br.el.removeAttribute('style');
                        });
                        block.hiddenBrs = [];
                    }
                }
            } else if (shouldBeLocked) {
                const textEl = block.maskNode.querySelector('.secure-text');
                if (textEl) textEl.innerHTML = msgHtml;
                const iconEl = block.maskNode.querySelector('use');
                if (iconEl) iconEl.setAttribute('href', '#' + icon);
            }
        });

      } catch (err) {
        console.error("Secure Content Error:", err);
      }
  }

  api.onAppEvent("post:created", (post) => {
      if (currentUser && post && post.topic_id) {
          localStorage.setItem(`secure_replied_${currentUser.id}:${post.topic_id}`, 'true');
          document.querySelectorAll('.cooked').forEach(el => {
              if (el._secureBlocks) {
                  applySecureContent(el, { getModel: () => ({ topic_id: post.topic_id }) });
              }
          });
      }
  });

  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);
    },
    { id: "secure-content-decorator" } 
  );
});
