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

  async function applySecureContent(element, helper) {
      const isPreview = element.classList.contains("d-editor-preview") || element.closest(".d-editor-preview");
      
      // 彻底移除对 helper.widget 的访问，完美修复官方升级警告！
      let topicId = helper?.getModel?.()?.topic_id || helper?.getModel?.()?.topic?.id || helper?.getModel?.()?.id;
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
              let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
              let startNode = null;
              while (walker.nextNode()) {
                  if (walker.currentNode.nodeValue.toLowerCase().includes(startTag)) {
                      startNode = walker.currentNode;
                      break;
                  }
              }
              if (!startNode) break; 

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

              if (startTagNode._secureProcessed) break;
              startTagNode._secureProcessed = true;

              // 清空标签的文字，保留节点
              startTagNode.nodeValue = "";
              endTagNode.nodeValue = "";

              // 【原位消灭换行】在任何状态下都向两边扫描，隐藏因为 markdown 解析而多出的换行
              const hideAdjacentBr = (node, direction) => {
                  let curr = direction === 'next' ? node.nextSibling : node.previousSibling;
                  while (curr) {
                      if (curr.nodeType === Node.TEXT_NODE && curr.nodeValue.trim() === '') {
                          curr = direction === 'next' ? curr.nextSibling : curr.previousSibling;
                          continue;
                      }
                      if (curr.nodeName === 'BR') {
                          curr.style.display = 'none';
                          curr.classList.add('secure-hidden-element');
                      }
                      break;
                  }
              };
              hideAdjacentBr(startTagNode, 'prev');
              hideAdjacentBr(startTagNode, 'next');
              hideAdjacentBr(endTagNode, 'prev');
              hideAdjacentBr(endTagNode, 'next');

              // 【编辑器预览模式】：插入提示框，内容依旧可见
              if (isPreview) {
                  let badge = document.createElement('div');
                  badge.className = 'secure-preview-badge';
                  badge.innerHTML = txt.preview;
                  startTagNode.parentNode.insertBefore(badge, startTagNode);
                  continue; 
              }

              // 【真实展示模式】：权限计算
              let isLocked = true;
              if (type === "login" && currentUser) isLocked = false;
              if (type === "reply" && (hasReplied || (currentUser && (currentUser.admin || currentUser.moderator || currentUser.id === helper?.getModel?.()?.user_id)))) isLocked = false;

              if (isLocked) {
                  // 原地打码大法：不动层级，让内容节点直接隐身
                  let nodesToHide = [];
                  let nWalker = document.createTreeWalker(element, NodeFilter.SHOW_ALL, null, false);
                  nWalker.currentNode = startTagNode;
                  while (nWalker.nextNode()) {
                      let curr = nWalker.currentNode;
                      if (curr === endTagNode) break;
                      if (!curr.contains(endTagNode)) nodesToHide.push(curr);
                  }

                  nodesToHide.forEach(node => {
                      if (node.nodeType === Node.ELEMENT_NODE) {
                          node.style.display = 'none';
                          node.classList.add('secure-hidden-element');
                      } else if (node.nodeType === Node.TEXT_NODE) {
                          node._secureOriginalText = node.nodeValue;
                          node.nodeValue = ''; 
                      }
                  });

                  // 插入优雅的苹果风提示框
                  let msgHtml = type === 'login' ? txt.mask_login : (!currentUser ? txt.mask_login_reply : txt.mask_reply);
                  let icon = type === 'login' ? 'lock' : (!currentUser ? 'lock' : 'reply');
                  let maskNode = renderMask(type, icon, msgHtml);
                  startTagNode.parentNode.insertBefore(maskNode, startTagNode);

                  // 精准消灭段落外边距（防止外层 P 标签留白）
                  let startP = startTagNode.parentNode;
                  if (startP && startP.nodeName === 'P') {
                      startP.classList.add('secure-mask-wrapper-p');
                  }
              } else {
                  // 解锁状态：呼叫外链护盾
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
              }

              // 【兜底消除空行】如果有 P 标签已经被抽空，原地隐藏
              let startP = startTagNode.parentNode;
              if (startP && startP.nodeName === 'P' && startP.textContent.trim() === '') {
                  startP.style.display = 'none';
                  startP.classList.add('secure-hidden-element');
              }
              let endP = endTagNode.parentNode;
              if (endP && endP.nodeName === 'P' && endP.textContent.trim() === '') {
                  endP.style.display = 'none';
                  endP.classList.add('secure-hidden-element');
              }
          }
      });
  }

  api.decorateCookedElement(
    (element, helper) => {
        applySecureContent(element, helper);
        // 使用简易防抖替换，避免 Glimmer 重绘打断
        let timer;
        if (typeof MutationObserver !== "undefined") {
            const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => applySecureContent(element, helper), 100);
            });
            observer.observe(element, { childList: true, subtree: true });
        }
    },
    { id: "secure-content-decorator" } 
  );
});
