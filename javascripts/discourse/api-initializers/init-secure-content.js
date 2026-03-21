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

  async function applySecureContent(element, helper) {
      const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
      
      let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.id || helper?.widget?.model?.topic_id || helper?.widget?.model?.id;
      if (!topicId) {
          const match = window.location.pathname.match(/\/t\/[^\/]+\/(\d+)/);
          if (match) topicId = match[1];
      }

      let hasReplied = false;
      if (currentUser && topicId && !isPreview) {
          hasReplied = await checkUserReplied(currentUser.id, topicId);
      }

      ['login', 'reply'].forEach(type => {
          const startTag = `[${type}]`;
          const endTag = `[/${type}]`;
          let safety = 50; 

          while (safety-- > 0) {
              // 1. 寻找文本节点
              let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
              let startNode = null;
              while (walker.nextNode()) {
                  if (walker.currentNode.nodeValue.toLowerCase().includes(startTag)) {
                      startNode = walker.currentNode;
                      break;
                  }
              }
              if (!startNode) break; 

              // 2. 切割分离出纯粹的标签节点
              let startIdx = startNode.nodeValue.toLowerCase().indexOf(startTag);
              let startTagNode = startNode.splitText(startIdx);
              startTagNode.splitText(startTag.length);

              walker.currentNode = startTagNode;
              let endNode = null;
              while (walker.nextNode()) {
                  if (walker.currentNode.nodeValue.toLowerCase().includes(endTag)) {
                      endNode = walker.currentNode;
                      break;
                  }
              }

              if (!endNode) {
                  startTagNode.nodeValue = ""; 
                  break;
              }

              let endIdx = endNode.nodeValue.toLowerCase().indexOf(endTag);
              let endTagNode = endNode.splitText(endIdx);
              endTagNode.splitText(endTag.length);

              // 清除标签文本
              startTagNode.nodeValue = "";
              endTagNode.nodeValue = "";

              // 【无损隐藏换行】：不删除节点！只隐藏周围的 BR 换行符
              const hideBr = (node) => {
                  if (node && node.nodeName === 'BR') {
                      node.style.display = 'none';
                  }
              };
              hideBr(startTagNode.previousSibling);
              hideBr(startTagNode.nextSibling);
              hideBr(endTagNode.previousSibling);
              hideBr(endTagNode.nextSibling);

              // ---------------- 编辑器预览模式 ----------------
              if (isPreview) {
                  let badge = document.createElement('div');
                  badge.className = 'secure-preview-badge';
                  badge.innerHTML = txt.preview;
                  startTagNode.parentNode.insertBefore(badge, startTagNode);
                  // 预览区我们直接保留内容可见，只加一个 Badge 提示
                  continue; 
              }

              // ---------------- 正式帖子模式 ----------------
              let isLocked = true;
              if (type === "login" && currentUser) isLocked = false;
              if (type === "reply" && (hasReplied || (currentUser && (currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id)))) isLocked = false;

              if (!isLocked) {
                  // 已解锁：不需要隐藏内容，直接呼叫外链护盾加图标
                  if (window.applyExternalLinkShield) {
                      let nWalker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null, false);
                      nWalker.currentNode = startTagNode;
                      while (nWalker.nextNode()) {
                          if (nWalker.currentNode === endTagNode) break;
                          if (!nWalker.currentNode.contains(endTagNode)) {
                              window.applyExternalLinkShield(nWalker.currentNode);
                          }
                      }
                  }
                  continue;
              }

              // ---------------- 锁定状态：原位无损隐身 ----------------
              let nodesToHide = [];
              let nWalker = document.createTreeWalker(element, NodeFilter.SHOW_ALL, null, false);
              nWalker.currentNode = startTagNode;
              while (nWalker.nextNode()) {
                  let curr = nWalker.currentNode;
                  if (curr === endTagNode) break;
                  if (!curr.contains(endTagNode)) nodesToHide.push(curr);
              }

              // 核心！不改变层级，直接隐身节点
              nodesToHide.forEach(node => {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                      node.style.display = 'none';
                      node.classList.add('secure-hidden-element');
                  } else if (node.nodeType === Node.TEXT_NODE) {
                      node.originalText = node.nodeValue; // 将文本暂存到对象上
                      node.nodeValue = ''; // 清空内容
                  }
              });

              // 【无损隐藏空段落】：如果段落只剩下不可见元素，则隐藏段落防止多余空行
              const hideIfEmpty = (el) => {
                  if (el && el.nodeName === 'P') {
                      const hasVisible = Array.from(el.childNodes).some(child => {
                          if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== '') return true;
                          if (child.nodeType === Node.ELEMENT_NODE && child.style.display !== 'none' && !child.classList.contains('secure-content-mask')) return true;
                          return false;
                      });
                      if (!hasVisible) el.style.display = 'none';
                  }
              };

              let maskNode = document.createElement("div");
              maskNode.className = `secure-content-mask apple-style type-${type}`;
              let msgHtml = type === 'login' ? txt.mask_login : (!currentUser ? txt.mask_login_reply : txt.mask_reply);
              let icon = type === 'login' ? 'lock' : (!currentUser ? 'lock' : 'reply');
              
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

              // 插入面具，大功告成
              startTagNode.parentNode.insertBefore(maskNode, startTagNode);
              hideIfEmpty(startTagNode.parentElement);
              hideIfEmpty(endTagNode.parentElement);
          }
      });
  }

  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);
        if (typeof MutationObserver !== "undefined") {
            let isProcessing = false;
            const observer = new MutationObserver(() => {
                if (isProcessing) return;
                isProcessing = true;
                applySecureContent(element, helper).finally(() => {
                    isProcessing = false;
                });
            });
            observer.observe(element, { childList: true, subtree: true });
        }
    },
    { id: "secure-content-decorator" } 
  );
});
