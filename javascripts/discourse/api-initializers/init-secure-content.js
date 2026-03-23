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
          while (safetyCounter++ < 50) { 
            let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let startNode = null;
            let endNode = null;

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

            // 1. 精确切分出标签边界
            let startSplitIndex = startNode.nodeValue.indexOf(startTag);
            let afterStartNode = startNode.splitText(startSplitIndex);
            afterStartNode.nodeValue = afterStartNode.nodeValue.replace(startTag, ""); 

            if (endNode === startNode) endNode = afterStartNode;

            let endSplitIndex = endNode.nodeValue.indexOf(endTag);
            let afterEndNode = endNode.splitText(endSplitIndex);
            afterEndNode.nodeValue = afterEndNode.nodeValue.replace(endTag, "");

            // 2. 权限判定
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

            // 3. 渲染并插入面具节点
            let maskNode = null;
            if (isPreview) {
               maskNode = document.createElement("div");
               maskNode.className = "secure-preview-badge"; 
               maskNode.textContent = txt.preview;
            } else if (isLocked) {
               maskNode = renderMask(type, icon, msgHtml);
            }

            if (maskNode) {
               afterStartNode.parentNode.insertBefore(maskNode, afterStartNode);
               // 如果这个 P 标签里只有面具（原标签被删了），强行干掉它的自带间距
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
            }

            // 4. 将包裹区间内的所有结构静默隐藏（保持 Glimmer 完整）
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
                        n.classList.add('secure-hidden-element'); // 隐藏包括里面的图片、换行、外部链接等
                    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() !== "") {
                        let span = document.createElement('span');
                        span.classList.add('secure-hidden-element');
                        n.parentNode.insertBefore(span, n);
                        span.appendChild(n);
                    }
                });
            } else {
               safeApplyLinkShield(element);
            }

            // 5. 【强力除草机】清理标签移除后产生的“幽灵空行”与空壳 <p>
            function cleanupWhitespace(node) {
                if (!node) return;
                
                // 如果文字节点空了，清理它旁边失去依靠的 <br> 换行
                if (node.nodeValue.trim() === "") {
                    if (node.nextSibling && node.nextSibling.tagName === 'BR') {
                        node.nextSibling.classList.add('secure-hidden-element');
                    } else if (node.previousSibling && node.previousSibling.tagName === 'BR') {
                        node.previousSibling.classList.add('secure-hidden-element');
                    }
                }

                // 检查父 P 标签是否变成了空壳
                let p = node.parentNode;
                if (p && p.tagName === 'P') {
                    let hasContent = Array.from(p.childNodes).some(child => {
                        // 隐藏物不算内容
                        if (child.classList && child.classList.contains('secure-hidden-element')) return false;
                        // 面具和徽章算有效内容（保留 P，靠上面的 secure-mask-wrapper-p 消灭 margin）
                        if (child.classList && (child.classList.contains('secure-content-mask') || child.classList.contains('secure-preview-badge'))) return true;
                        // 其他真实存在的元素（除 br 外）或非空文本算内容
                        if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') return true;
                        if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== "") return true;
                        return false;
                    });
                    
                    // 如果啥都不剩了（比如解锁后的 [reply] 单独占一行），彻底隐藏这个 P 标签！
                    if (!hasContent) {
                        p.classList.add('secure-hidden-element');
                    }
                }
            }

            cleanupWhitespace(afterStartNode);
            cleanupWhitespace(afterEndNode);
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
