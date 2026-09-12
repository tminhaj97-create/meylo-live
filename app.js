const firebaseConfig = {
  apiKey: "AIzaSyCakONYwg8WAkoSxFBp_B7CuPRI0ONfq6Y",
  authDomain: "meylo-a6e64.firebaseapp.com",
  databaseURL: "https://meylo-a6e64-default-rtdb.firebaseio.com",
  projectId: "meylo-a6e64",
  storageBucket: "meylo-a6e64.firebasestorage.app",
  messagingSenderId: "854696371817",
  appId: "1:854696371817:web:ad85a9db4ce063f60464f8"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

let onlineUsers = [];
let currentUser = null;
let coins = 0;
let vip = false;
let activeChatUser = null;
let dI = 0;
let boostInterval = null;
let todayStr = new Date().toDateString();

// ---- XSS PROTECTION ----
// Any user-supplied text (name, bio, chat message) MUST pass through this
// before being inserted with innerHTML. This prevents someone from sending
// a message like <img src=x onerror=alert(1)> and having it execute.
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function defaultDailyTasks() {
    return {
        date: todayStr,
        login: { progress: 1, target: 1, claimed: false, reward: 5, icon: 'fa-calendar-check', title: 'Daily Login', desc: 'Open Meylo daily' },
        profile: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-user-edit', title: 'Complete Profile', desc: 'Set your profile bio' },
        messages: { progress: 0, target: 3, claimed: false, reward: 5, icon: 'fa-paper-plane', title: 'Send 3 Messages', desc: 'Chat with matches' },
        likes: { progress: 0, target: 5, claimed: false, reward: 5, icon: 'fa-heart', title: 'Like 5 Profiles', desc: 'Swipe on discover' },
        watchad: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-ad', title: 'Watch 1 Ad', desc: 'Watch a video ad' },
        visit3: { progress: 0, target: 3, claimed: false, reward: 5, icon: 'fa-eye', title: 'Visit 3 Profiles', desc: 'Check out other profiles' },
        passport: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-plane', title: 'Use Passport', desc: 'Browse another city' },
        sendgift: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-gift', title: 'Send a Gift', desc: 'Send a virtual gift to a match' }
    };
}

let dailyTasks = JSON.parse(localStorage.getItem('meylo_tasks')) || defaultDailyTasks();
if (dailyTasks.date !== todayStr) {
    dailyTasks = defaultDailyTasks();
} else {
    // Merge in any task keys that didn't exist yet in previously-saved data
    // (e.g. the user already had today's tasks cached before new task types
    // like visit3/passport/sendgift were added) — without this, renderTasks()
    // would throw on the missing key and silently fail to render ANY tasks.
    const template = defaultDailyTasks();
    Object.keys(template).forEach(key => {
        if (key !== 'date' && !dailyTasks[key]) {
            dailyTasks[key] = template[key];
        }
    });
}
localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));

let adD = JSON.parse(localStorage.getItem('meylo_ad_watch')) || { d: todayStr, c: 0 };
if (adD.d !== todayStr) adD = { d: todayStr, c: 0 };

let spD = JSON.parse(localStorage.getItem('meylo_spin')) || { d: todayStr, free: false, extra: 0 };
if (spD.d !== todayStr) spD = { d: todayStr, free: false, extra: 0 };

// HARDWARE/BROWSER BACK BUTTON FIX
window.onpopstate = function (e) {
    const openModals = document.querySelectorAll('.modal-overlay.open');
    if (openModals.length > 0) {
        openModals.forEach(m => m.classList.remove('open'));
        return;
    }
    const currentActive = document.querySelector('.portal-view.active');
    if (currentActive && currentActive.id !== 'view-swipeDeck') {
        switchV('swipeDeck', document.getElementById('bbtn-swipeDeck'));
    }
};

window.onload = () => {
    history.pushState({ view: 'home' }, '');
    window.addEventListener('scroll', () => {
        const nav = document.getElementById('navbar');
        if (window.scrollY > 50) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
    });
    const dobInput = document.getElementById('rDob');
    if (dobInput) dobInput.max = new Date().toISOString().slice(0, 10);
    checkPaymentReturnStatus();
};

// ---- REAL AUTHENTICATION STATE ----
// This replaces the old "read a user object out of localStorage" approach.
// Firebase now tells us, cryptographically, whether someone is really logged in.
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const snap = await db.ref('users/' + user.uid).once('value');
            const profile = snap.val();
            if (profile) {
                currentUser = profile;
                currentUser.uid = user.uid;
                coins = currentUser.coins || 0;
                // VIP expiry check: if vipExpiresAt has passed, treat as
                // non-VIP here in the app even though the database still
                // has vip:true (we don't rewrite it — see note below).
                const vipStillActive = currentUser.vip && (!currentUser.vipExpiresAt || Date.now() < currentUser.vipExpiresAt);
                vip = !!vipStillActive;
                initPortal();
                syncWithFirebase();
            } else {
                showToast("⚠️ Profile missing — please contact support");
            }
        } catch (err) {
            showToast("⚠️ Could not load profile");
        }
    } else {
        currentUser = null;
        document.getElementById('guestHero').style.display = 'block';
        document.getElementById('guestNavLinks').style.display = 'flex';
        document.getElementById('appPortal').style.display = 'none';
        document.getElementById('bnav').style.display = 'none';
        document.getElementById('navBadge').style.display = 'none';
        document.getElementById('authBtn').style.display = 'inline-flex';
    }
});

function initPortal() {
    document.getElementById('guestHero').style.display = 'none';
    document.getElementById('guestNavLinks').style.display = 'none';
    document.getElementById('appPortal').style.display = window.innerWidth > 768 ? 'grid' : 'block';
    document.getElementById('bnav').style.display = window.innerWidth > 768 ? 'none' : 'block';
    if (window.innerWidth > 768) document.getElementById('deskSidebar').style.display = 'flex';
    document.getElementById('navBadge').style.display = 'flex';
    document.getElementById('authBtn').style.display = 'none';
    document.getElementById('navNm').innerText = currentUser.name; // set via innerText, not innerHTML — safe
    document.getElementById('navC').innerText = coins;
    document.getElementById('navAv').src = currentUser.avatar || ('https://via.placeholder.com/40/ff2d6f/fff?text=' + encodeURIComponent(currentUser.name[0] || '?'));
    if (vip) document.getElementById('vipL').style.display = 'block';

    renderProf();
    renderTasks();
    updateSpinUI();
    listenForIncomingCalls();
    updateBoostBanner();
    const settingsEmailEl = document.getElementById('settingsEmail');
    if (settingsEmailEl && auth.currentUser) settingsEmailEl.innerText = auth.currentUser.email || '—';

    const verifyText = document.getElementById('verifyStatusText');
    const resendBtn = document.getElementById('resendVerifyBtn');
    if (verifyText && auth.currentUser) {
        if (auth.currentUser.emailVerified) {
            verifyText.innerHTML = '<i class="fas fa-check-circle" style="color:var(--green)"></i> Email verified';
            resendBtn.style.display = 'none';
        } else {
            verifyText.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--gold)"></i> Email not verified';
            resendBtn.style.display = 'inline-block';
        }
    }
}

let hiddenUids = new Set(); // people I've blocked, or who've blocked me

function loadBlockLists() {
    if (!currentUser || !currentUser.uid) return;
    const myBlocks = db.ref(`blocks/${currentUser.uid}`);
    const myBlockedBy = db.ref(`blockedBy/${currentUser.uid}`);

    function refreshHidden() {
        Promise.all([myBlocks.once('value'), myBlockedBy.once('value')]).then(([a, b]) => {
            const setA = Object.keys(a.val() || {});
            const setB = Object.keys(b.val() || {});
            hiddenUids = new Set([...setA, ...setB]);
            renderMatches();
            loadCard();
        });
    }
    myBlocks.on('value', refreshHidden);
    myBlockedBy.on('value', refreshHidden);
}

async function blockUser(targetUid) {
    if (!currentUser || !targetUid) return;
    try {
        await db.ref(`blocks/${currentUser.uid}/${targetUid}`).set(true);
        await db.ref(`blockedBy/${targetUid}/${currentUser.uid}`).set(true);
        showToast('🚫 User blocked');
        closeMo('visitMo');
        if (activeChatUser && activeChatUser.id === targetUid) {
            activeChatUser = null;
            switchV('swipeDeck', document.getElementById('bbtn-swipeDeck'));
        }
    } catch (err) {
        showToast('⚠️ Could not block user');
    }
}

function openReportModal(targetUid, targetName) {
    reportTargetUid = targetUid;
    document.getElementById('reportTargetName').innerText = targetName || 'this user';
    document.querySelectorAll('#reportReasons .interest-tag').forEach(t => t.classList.remove('selected'));
    openMo('reportMo');
}

let reportTargetUid = null;

async function submitReport() {
    const selected = document.querySelector('#reportReasons .interest-tag.selected');
    if (!selected) { showToast('⚠️ Please select a reason'); return; }
    if (!reportTargetUid || !currentUser) return;

    try {
        await db.ref('reports').push({
            reporterId: currentUser.uid,
            reportedId: reportTargetUid,
            reason: selected.dataset.reason,
            timestamp: Date.now()
        });
        closeMo('reportMo');
        closeMo('visitMo');
        showToast('✅ Report submitted — thank you');
    } catch (err) {
        showToast('⚠️ Could not submit report');
    }
}

function syncWithFirebase() {
    if (currentUser && currentUser.uid) {
        // Only fields the database rules allow us to write are sent here.
        // coins/vip are intentionally excluded — those can only be changed
        // server-side (e.g. via a Cloud Function after a verified payment).
        db.ref('users/' + currentUser.uid).update({
            id: currentUser.uid,
            name: currentUser.name,
            age: currentUser.age,
            gender: currentUser.gender || 'female',
            city: currentUser.city || 'Dhaka',
            avatar: currentUser.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop',
            gallery: currentUser.gallery || [],
            bio: currentUser.bio || '',
            height: currentUser.height || '',
            body: currentUser.body || '',
            goal: currentUser.goal || '',
            zodiac: currentUser.zodiac || '',
            occupation: currentUser.occupation || '',
            interests: currentUser.interests || [],
            voiceIntro: currentUser.voiceIntro || null,
            lastSeen: Date.now()
        });
        loadBlockLists();
    }

    db.ref('users').on('value', snapshot => {
        const data = snapshot.val();
        onlineUsers = [];
        if (data) {
            Object.keys(data).forEach(key => {
                if ((!currentUser || key !== currentUser.uid) && !hiddenUids.has(key)) {
                    onlineUsers.push(data[key]);
                }
            });
        }
        if (onlineUsers.length === 0) {
            onlineUsers = [
                { id: 'sample1', name: 'Jessica, 22', city: 'London, UK', age: 22, gender: 'female', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop', gallery: ['https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop'], bio: 'Coffee & music lover.', height: "5'6\"", body: "Slim", zodiac: "Leo", occupation: "Designer", interests: ["🎵 Music", "☕ Coffee", "🎨 Art"] },
                { id: 'sample2', name: 'Sophia, 24', city: 'New York, USA', age: 24, gender: 'female', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop', gallery: ['https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop'], bio: 'Tech geek & world traveler.', height: "5'8\"", body: "Athletic", zodiac: "Virgo", occupation: "Engineer", interests: ["✈️ Travel", "📸 Photography"] }
            ];
        } else {
            // Boosted profiles (boostedUntil still in the future) appear
            // first — boostedUntil can only ever be set by our server
            // (see database.rules.json), so this can't be gamed by editing
            // a profile's own data directly.
            const now = Date.now();
            onlineUsers.sort((a, b) => {
                const aBoost = (a.boostedUntil || 0) > now ? 1 : 0;
                const bBoost = (b.boostedUntil || 0) > now ? 1 : 0;
                return bBoost - aBoost;
            });
        }
        loadCard();
        renderMatches();
    }, err => {
        // If this ever fails (e.g. a permissions issue), surface it clearly
        // instead of leaving the Discover deck silently empty forever.
        showToast('⚠️ Could not load users: ' + err.message);
    });
}

// ---- TOUCH GESTURE DRAG & SWIPE ----
function attachSwipeGestures(cardEl) {
    let startX = 0, startY = 0, moveX = 0, moveY = 0, isDragging = false;
    const startDrag = (x, y) => { startX = x; startY = y; isDragging = true; cardEl.style.transition = 'none'; };
    const dragMove = (x, y) => {
        if (!isDragging) return;
        moveX = x - startX; moveY = y - startY;
        cardEl.style.transform = `translate(${moveX}px, ${moveY}px) rotate(${moveX * 0.08}deg)`;
    };
    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        cardEl.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
        if (moveX > 90) {
            cardEl.style.transform = `translate(300px, ${moveY}px) rotate(30deg)`;
            cardEl.style.opacity = '0';
            setTimeout(() => { swipeR(); }, 300);
        } else if (moveX < -90) {
            cardEl.style.transform = `translate(-300px, ${moveY}px) rotate(-30deg)`;
            cardEl.style.opacity = '0';
            setTimeout(() => { swipeL(); }, 300);
        } else {
            cardEl.style.transform = 'translate(0, 0) rotate(0deg)';
        }
    };
    cardEl.addEventListener('touchstart', e => startDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    cardEl.addEventListener('touchmove', e => dragMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    cardEl.addEventListener('touchend', endDrag);
    cardEl.addEventListener('mousedown', e => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => { if (isDragging) dragMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (isDragging) endDrag(); });
}

function loadCard() {
    const c = document.getElementById('deckCard');
    if (!onlineUsers || dI >= onlineUsers.length) {
        c.innerHTML = '<div style="padding:60px 0;color:#555;text-align:center">No more profiles!<br><button class="btn-primary" style="margin-top:12px" onclick="dI=0;loadCard()">Reset Discover</button></div>';
        return;
    }
    const p = onlineUsers[dI];
    // name/city come from the database and are shown via template — escape them
    c.innerHTML = `
    <div class="portal-swipe-card" id="activeSwipeCard">
        <img src="${escapeHTML(p.avatar) || 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop'}">
        <div class="portal-card-info">
            <h3>${escapeHTML(p.name)} <i class="fas fa-check-circle vbi"></i></h3>
            <p>📍 ${escapeHTML(p.city) || 'Global'}</p>
        </div>
    </div>`;
    const cardEl = document.getElementById('activeSwipeCard');
    if (cardEl) attachSwipeGestures(cardEl);
}

function swipeL() { if (dI < onlineUsers.length) { dI++; loadCard(); } }
function swipeR() {
    if (dI < onlineUsers.length) {
        const p = onlineUsers[dI];
        dI++; loadCard();
        showToast("💖 Match with " + p.name.split(',')[0]);
        // Record the like server-side (one entry per target per day, can't be
        // overwritten — see database.rules.json). This is what /api/claim-task
        // actually counts, instead of trusting a client-side counter.
        if (currentUser && currentUser.uid && p.id) {
            const today = new Date().toISOString().slice(0, 10);
            db.ref(`likesLog/${currentUser.uid}/${today}/${p.id}`).set(true).catch(() => {});
        }
        selChat(p);
    }
}
function rewindSwipe() { if (dI > 0) { dI--; loadCard(); showToast("⏪ Rewound!"); } }
function openSuperLikeModal() { showToast("⭐ Super Like Sent!"); swipeR(); }

function switchV(v, btn) {
    history.pushState({ view: v }, '');
    document.querySelectorAll('.portal-view').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('view-' + v);
    if (target) target.classList.add('active');
    document.querySelectorAll('.bnav-btn,.sidebar-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const bbtn = document.getElementById('bbtn-' + v); if (bbtn) bbtn.classList.add('active');
    closeDD();
}

function setGF(el, g) { dI = 0; loadCard(); }

function renderMatches() {
    const list = document.getElementById('chatMatchesList');
    list.innerHTML = onlineUsers.map(p => `
        <div class="chat-user-item ${activeChatUser && activeChatUser.id === p.id ? 'active' : ''}" onclick="selChatById('${escapeHTML(p.id)}')">
            <img src="${escapeHTML(p.avatar)}">
            <div class="chat-user-meta">
                <h4>${escapeHTML(p.name.split(',')[0])} <i class="fas fa-check-circle vbi"></i></h4>
                <p>Tap to live chat</p>
            </div>
        </div>
    `).join('');
}

function selChatById(id) {
    const p = onlineUsers.find(x => x.id === id);
    if (p) selChat(p);
}

function selChat(p) {
    activeChatUser = p;
    document.getElementById('chNm').innerText = p.name.split(',')[0]; // innerText = safe
    document.getElementById('chAv').src = p.avatar;
    renderMatches();
    listenToFirebaseMessages();
}

function getChatRoomId(uid1, uid2) {
    return uid1 < uid2 ? uid1 + '_' + uid2 : uid2 + '_' + uid1;
}

function listenToFirebaseMessages() {
    if (!currentUser || !activeChatUser) return;
    const roomId = getChatRoomId(currentUser.uid, activeChatUser.id);
    const msgsBox = document.getElementById('chMsgs');

    db.ref('messages/' + roomId).on('value', snapshot => {
        msgsBox.innerHTML = '';
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const msg = data[key];
                const isMe = msg.senderId === currentUser.uid;
                if (msg.type === 'gift') {
                    // Gift messages are pushed by our server (/api/send-gift) only
                    // after it verified and deducted real coins — never trust a
                    // gift message that could have been written by a client directly.
                    msgsBox.innerHTML += `<div class="chat-bubble ${isMe ? 'outgoing' : 'incoming'}" style="background:${isMe ? 'var(--accent)' : '#241a08'};border:1px solid var(--gold)">🎁 ${isMe ? 'You sent' : 'Sent'} a ${escapeHTML(msg.giftName || 'gift')}</div>`;
                } else {
                    // CRITICAL: message text is user-typed — always escape before innerHTML
                    msgsBox.innerHTML += `<div class="chat-bubble ${isMe ? 'outgoing' : 'incoming'}">${escapeHTML(msg.text)}</div>`;
                }
            });
            msgsBox.scrollTop = msgsBox.scrollHeight;
        } else {
            msgsBox.innerHTML = '<div style="text-align:center;color:#666;font-size:12px;margin-top:20px">Say hello to start conversation! 👋</div>';
        }
    });
}

// ---- VIRTUAL GIFTING ----
// Sending a gift costs coins, so — just like watch-ad and claim-task — this
// MUST go through the server. The server verifies the sender's real coin
// balance, deducts atomically, and is the one that writes the gift message
// to the chat, so a client can never fake "I sent a diamond" without paying.
function openGiftPicker() {
    if (!activeChatUser) { showToast('⚠️ Open a chat first'); return; }
    document.getElementById('giftCoinBalance').innerText = coins;
    history.pushState({ modal: 'gift' }, '');
    openMo('giftMo');
}

async function sendGift(giftId) {
    if (!activeChatUser) return;
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/send-gift', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUid: activeChatUser.id, giftId: giftId })
        });
        const data = await resp.json();
        if (!resp.ok) { showToast('⚠️ ' + (data.error || 'Could not send gift')); return; }
        coins = data.newCoinBalance;
        currentUser.coins = coins;
        document.getElementById('navC').innerText = coins;
        closeMo('giftMo');
        updateTaskProgress('sendgift', 1);
        showToast(`🎁 Gift sent!`);
    } catch (err) {
        showToast('⚠️ Network error — try again');
    }
}

function sendM() {
    const inp = document.getElementById('chIn');
    const text = inp.value.trim();
    if (!text || !activeChatUser || !currentUser) return;
    if (text.length > 1000) { showToast("⚠️ Message too long"); return; }

    const roomId = getChatRoomId(currentUser.uid, activeChatUser.id);
    db.ref('messages/' + roomId).push({
        senderId: currentUser.uid,
        senderName: currentUser.name,
        text: text, // stored raw; escaped only at render time (best practice — never lose original data)
        timestamp: Date.now()
    });
    inp.value = '';
    updateTaskProgress('messages', 1);
}

// ---- VISIT OTHER PROFILES ----
let curVisUser = null, visPicIdx = 0;
function openV(id) {
    history.pushState({ modal: 'visit' }, '');
    const p = onlineUsers.find(x => x.id === id) || onlineUsers[0];
    if (!p) return;
    curVisUser = p; visPicIdx = 0;
    if (currentUser && currentUser.uid && p.id) {
        const today = new Date().toISOString().slice(0, 10);
        db.ref(`visitsLog/${currentUser.uid}/${today}/${p.id}`).set(true).catch(() => {});
        updateTaskProgress('visit3', 1);
    }
    document.getElementById('vNm').innerHTML = `${escapeHTML(p.name)} <i class="fas fa-check-circle vbi"></i>`;
    document.getElementById('vSub').innerText = `📍 ${p.city || 'Global'}`;
    document.getElementById('vBio').innerText = p.bio || 'No bio added.';
    const vVp = document.getElementById('vVoicePlayer');
    if (p.voiceIntro) { vVp.src = p.voiceIntro; vVp.style.display = 'block'; }
    else { vVp.style.display = 'none'; }
    renderVPic();

    let d = '';
    if (p.height) d += `<span class="detail-badge"><i class="fas fa-ruler-vertical"></i> ${escapeHTML(p.height)}</span>`;
    if (p.body) d += `<span class="detail-badge"><i class="fas fa-child"></i> ${escapeHTML(p.body)}</span>`;
    if (p.zodiac) d += `<span class="detail-badge"><i class="fas fa-star"></i> ${escapeHTML(p.zodiac)}</span>`;
    if (p.occupation) d += `<span class="detail-badge"><i class="fas fa-briefcase"></i> ${escapeHTML(p.occupation)}</span>`;
    document.getElementById('vDet').innerHTML = d || '<span style="color:#555;font-size:11px">No details provided</span>';
    document.getElementById('vInts').innerHTML = (p.interests || []).map(i => `<span class="detail-badge">${escapeHTML(i)}</span>`).join('') || '<span style="color:#555;font-size:11px">No interests</span>';

    openMo('visitMo');
}
function renderVPic() {
    const gal = (curVisUser.gallery && curVisUser.gallery.length) ? curVisUser.gallery : [curVisUser.avatar];
    document.getElementById('vPic').src = gal[visPicIdx] || curVisUser.avatar;
    document.getElementById('vDots').innerHTML = gal.map((_, i) => `<div class="dot ${i === visPicIdx ? 'active' : ''}"></div>`).join('');
}
function vNav(dir) {
    const gal = (curVisUser.gallery && curVisUser.gallery.length) ? curVisUser.gallery : [curVisUser.avatar];
    visPicIdx = (visPicIdx + dir + gal.length) % gal.length;
    renderVPic();
}
function vAct(type) {
    closeMo('visitMo');
    if (type === 'chat') { switchV('messages', document.getElementById('bbtn-messages')); selChat(curVisUser); }
    else startAutoMatch();
}
function visitFromChat() { if (activeChatUser) openV(activeChatUser.id); }

// ---- MY PROFILE ----
function renderProf() {
    if (!currentUser) return;
    document.getElementById('myNm').innerHTML = `${escapeHTML(currentUser.name)}, ${escapeHTML(currentUser.age)} <i class="fas fa-check-circle vbi"></i>`;
    document.getElementById('myMeta').innerText = `📍 ${currentUser.city || 'Global'}`;
    document.getElementById('myBio').innerText = currentUser.bio || 'No bio added yet. Tap Edit to add!';
    const myVp = document.getElementById('myVoicePlayer');
    if (currentUser.voiceIntro) { myVp.src = currentUser.voiceIntro; myVp.style.display = 'block'; }
    else { myVp.style.display = 'none'; }
    document.getElementById('myAv').src = currentUser.avatar || ('https://via.placeholder.com/80/ff2d6f/fff?text=' + encodeURIComponent(currentUser.name[0] || '?'));

    const gal = currentUser.gallery || [];
    let h = '';
    for (let i = 0; i < 6; i++) {
        if (gal[i]) h += `<div class="gallery-slot filled ${i === 0 ? 'main-photo' : ''}"><img src="${escapeHTML(gal[i])}"><button class="gallery-del" onclick="delP(${i})"><i class="fas fa-times"></i></button></div>`;
        else h += `<div class="gallery-slot" onclick="document.getElementById('galIn').click()"><span>+</span></div>`;
    }
    document.getElementById('myGal').innerHTML = h;

    let d = '';
    if (currentUser.height) d += `<span class="detail-badge"><i class="fas fa-ruler-vertical"></i> ${escapeHTML(currentUser.height)}</span>`;
    if (currentUser.body) d += `<span class="detail-badge"><i class="fas fa-child"></i> ${escapeHTML(currentUser.body)}</span>`;
    if (currentUser.goal) d += `<span class="detail-badge"><i class="fas fa-heart"></i> ${escapeHTML(currentUser.goal)}</span>`;
    if (currentUser.zodiac) d += `<span class="detail-badge"><i class="fas fa-star"></i> ${escapeHTML(currentUser.zodiac)}</span>`;
    if (currentUser.occupation) d += `<span class="detail-badge"><i class="fas fa-briefcase"></i> ${escapeHTML(currentUser.occupation)}</span>`;
    document.getElementById('myDet').innerHTML = d || '<span style="color:#555;font-size:11px">No details added yet</span>';

    document.getElementById('myInt').innerHTML = (currentUser.interests || []).map(i => `<span class="detail-badge">${escapeHTML(i)}</span>`).join('') || '<span style="color:#555;font-size:11px">No interests added yet</span>';
}

// Photos now upload to Firebase Storage (a proper file storage service)
function upPhoto(e) {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) { showToast("⚠️ Image must be under 4MB"); return; }
    if (!f.type.startsWith('image/')) { showToast("⚠️ Please choose an image file"); return; }

    const r = new FileReader();
    r.onload = (evt) => {
        if (!currentUser.gallery) currentUser.gallery = [];
        if (currentUser.gallery.length >= 6) { showToast("⚠️ Max 6 photos allowed!"); return; }
        currentUser.gallery.push(evt.target.result);
        if (!currentUser.avatar) currentUser.avatar = evt.target.result;
        renderProf();
        document.getElementById('navAv').src = currentUser.avatar;
        syncWithFirebase();
        showToast("📸 Photo added to gallery!");
    };
    r.readAsDataURL(f);
}

// Clicking directly on the profile avatar calls this — replaces the MAIN
// photo (gallery slot 0) in place, instead of requiring delete-then-re-add.
function changeMainPhoto(e) {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) { showToast("⚠️ Image must be under 4MB"); return; }
    if (!f.type.startsWith('image/')) { showToast("⚠️ Please choose an image file"); return; }

    const r = new FileReader();
    r.onload = (evt) => {
        if (!currentUser.gallery) currentUser.gallery = [];
        currentUser.gallery[0] = evt.target.result;
        currentUser.avatar = evt.target.result;
        renderProf();
        document.getElementById('navAv').src = currentUser.avatar;
        syncWithFirebase();
        showToast("📸 Profile photo updated!");
        e.target.value = '';
    };
    r.readAsDataURL(f);
}

// ---- VOICE INTRO RECORDING ----
let voiceMediaRecorder = null, voiceChunks = [], voiceStream = null, voiceRecTimer = null, voiceRecSeconds = 0;
let pendingVoiceDataUrl = null; // holds the just-recorded clip until saved
const VOICE_MAX_SECONDS = 15;

async function toggleVoiceRecording() {
    if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
        voiceMediaRecorder.stop();
        return;
    }
    try {
        voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceChunks = [];
        voiceMediaRecorder = new MediaRecorder(voiceStream);
        voiceMediaRecorder.ondataavailable = e => { if (e.data.size > 0) voiceChunks.push(e.data); };
        voiceMediaRecorder.onstop = () => {
            clearInterval(voiceRecTimer);
            voiceStream.getTracks().forEach(t => t.stop());
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                pendingVoiceDataUrl = reader.result;
                const player = document.getElementById('voicePreview');
                player.src = pendingVoiceDataUrl;
                player.style.display = 'block';
                document.getElementById('voiceRecStatus').innerText = 'Recorded — click Save Details to keep it';
                document.getElementById('voiceRecBtn').innerHTML = '<i class="fas fa-microphone"></i> Re-record';
                document.getElementById('voiceDeleteBtn').style.display = 'inline-block';
            };
            reader.readAsDataURL(blob);
        };

        voiceMediaRecorder.start();
        voiceRecSeconds = 0;
        document.getElementById('voiceRecBtn').innerHTML = '<i class="fas fa-stop"></i> Stop';
        document.getElementById('voiceRecStatus').innerText = `Recording... 0/${VOICE_MAX_SECONDS}s`;
        voiceRecTimer = setInterval(() => {
            voiceRecSeconds++;
            document.getElementById('voiceRecStatus').innerText = `Recording... ${voiceRecSeconds}/${VOICE_MAX_SECONDS}s`;
            if (voiceRecSeconds >= VOICE_MAX_SECONDS) voiceMediaRecorder.stop();
        }, 1000);
    } catch (e) {
        showToast('⚠️ Microphone access denied or unavailable');
    }
}

function deleteVoiceIntro() {
    pendingVoiceDataUrl = null;
    currentUser.voiceIntro = null;
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('voiceDeleteBtn').style.display = 'none';
    document.getElementById('voiceRecStatus').innerText = 'No recording yet';
    document.getElementById('voiceRecBtn').innerHTML = '<i class="fas fa-microphone"></i> Record';
    syncWithFirebase();
    renderProf();
    showToast('🗑️ Voice intro removed');
}

function delP(idx) {
    currentUser.gallery.splice(idx, 1);
    currentUser.avatar = currentUser.gallery[0] || '';
    renderProf();
    document.getElementById('navAv').src = currentUser.avatar || ('https://via.placeholder.com/40/ff2d6f/fff?text=' + encodeURIComponent(currentUser.name[0] || '?'));
    syncWithFirebase();
    showToast("🗑️ Photo removed");
}

function openEdit() {
    history.pushState({ modal: 'edit' }, '');
    document.getElementById('eBio').value = currentUser.bio || '';
    document.getElementById('eH').value = currentUser.height || '';
    document.getElementById('eB').value = currentUser.body || '';
    document.getElementById('eG').value = currentUser.goal || '';
    document.getElementById('eZ').value = currentUser.zodiac || '';
    document.getElementById('eJ').value = currentUser.occupation || '';
    document.getElementById('eC').value = currentUser.city || '';

    // Voice intro UI reset
    pendingVoiceDataUrl = null;
    const player = document.getElementById('voicePreview');
    if (currentUser.voiceIntro) {
        player.src = currentUser.voiceIntro;
        player.style.display = 'block';
        document.getElementById('voiceRecStatus').innerText = 'Saved voice intro';
        document.getElementById('voiceDeleteBtn').style.display = 'inline-block';
    } else {
        player.style.display = 'none';
        document.getElementById('voiceRecStatus').innerText = 'No recording yet';
        document.getElementById('voiceDeleteBtn').style.display = 'none';
    }
    document.getElementById('voiceRecBtn').innerHTML = '<i class="fas fa-microphone"></i> Record';

    openMo('editMo');
}

async function saveProf() {
    currentUser.bio = document.getElementById('eBio').value.trim().slice(0, 500);
    currentUser.height = document.getElementById('eH').value.trim().slice(0, 20);
    currentUser.body = document.getElementById('eB').value;
    currentUser.goal = document.getElementById('eG').value;
    currentUser.zodiac = document.getElementById('eZ').value;
    currentUser.occupation = document.getElementById('eJ').value.trim().slice(0, 60);
    currentUser.city = document.getElementById('eC').value.trim().slice(0, 60);

    const ints = [];
    document.querySelectorAll('#eIntBox .interest-tag.selected').forEach(t => ints.push(t.innerText));
    currentUser.interests = ints;

    if (pendingVoiceDataUrl) {
        currentUser.voiceIntro = pendingVoiceDataUrl;
        pendingVoiceDataUrl = null;
    }

    renderProf(); closeMo('editMo');
    syncWithFirebase();
    updateTaskProgress('profile', 1);
    showToast("✅ Profile Saved!");
}

// ---- PAYMENTS ----
// Real payment flow via SSLCommerz (currently sandbox/test mode — see the
// notice on the Coin Store / VIP pages). The server (/api/initiate-payment)
// decides the actual price from its own catalog — this function just tells
// it WHICH package the user picked, then redirects to SSLCommerz's hosted
// checkout page. After payment, SSLCommerz redirects back to our app, and
// /api/payment-success independently re-verifies the payment before
// crediting anything (see that file for details).
async function startPayment(packageId) {
    if (!currentUser) { showToast("⚠️ Please log in first"); return; }
    showToast("⏳ Starting secure checkout...");
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/initiate-payment', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageId })
        });
        const data = await resp.json();
        if (!resp.ok || !data.gatewayUrl) {
            showToast('⚠️ ' + (data.error || 'Could not start payment'));
            return;
        }
        window.location.href = data.gatewayUrl; // hand off to SSLCommerz's hosted checkout
    } catch (err) {
        showToast('⚠️ Network error — try again');
    }
}

// Runs on page load — checks if we just came back from a payment redirect
// (?payment=success/failed/cancelled) and shows the result, then cleans up
// the URL so refreshing doesn't re-trigger the message.
function checkPaymentReturnStatus() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (!status) return;
    if (status === 'success') showToast('🎉 Payment successful! Coins/VIP have been added.');
    else if (status === 'cancelled') showToast('Payment cancelled.');
    else showToast('⚠️ Payment failed — no charge was made.');
    params.delete('payment');
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', newUrl);
}

// ============================================================
// REAL VIDEO/AUDIO CALLS (WebRTC)
// ============================================================
// Signaling (exchanging connection info between the two browsers) happens
// through Firebase Realtime Database under calls/{callId} — this is NOT
// the video/audio itself, just the handshake info (offer/answer/ICE
// candidates) needed for the two browsers to find a direct route to each
// other. Once connected, video/audio flows directly between the two
// devices (peer-to-peer), not through our server.
//
// LIMITATION (partially addressed): a free public TURN server (Open Relay
// Project by Metered) is now included as a fallback below. It requires no
// signup, but as a shared free public service it isn't guaranteed to be
// fast, always-up, or unlimited — a paid dedicated TURN service (e.g. via
// Twilio) would be more reliable if call-connect failures become common.
// LIMITATION (now addressed with layered fallbacks): TURN relays help
// calls connect on networks where a direct peer-to-peer route is blocked
// (strict firewalls, some carrier NAT). We try, in order:
//   1. Authenticated TURN credentials from Metered's Open Relay, fetched
//      fresh per-call via /api/turn-credentials (best — requires the site
//      owner to sign up for a free Metered account and set
//      METERED_DOMAIN/METERED_API_KEY in Vercel; falls through if unset).
//   2. A static shared public TURN server (best-effort, no signup, but
//      shared with other apps and not guaranteed to always be available).
//   3. STUN-only (works on most open networks, but not strict ones).
const STATIC_FALLBACK_ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};

async function getIceServers() {
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/turn-credentials', {
            headers: { 'Authorization': 'Bearer ' + idToken }
        });
        if (!resp.ok) return STATIC_FALLBACK_ICE_SERVERS;
        const data = await resp.json();
        if (!data.iceServers || !data.iceServers.length) return STATIC_FALLBACK_ICE_SERVERS;
        return { iceServers: data.iceServers };
    } catch (err) {
        return STATIC_FALLBACK_ICE_SERVERS;
    }
}

let pc = null;
let localStream = null;
let currentCallId = null;
let currentCallRole = null; // 'caller' | 'callee'
let pendingIncomingCall = null;
let callActiveListeners = [];
let callBillingTimer = null, callSecs = 0;
let callType = 'video';

function trackCallListener(ref, event) {
    callActiveListeners.push({ ref, event });
}

function detachCallListeners() {
    callActiveListeners.forEach(({ ref, event }) => ref.off(event));
    callActiveListeners = [];
}

// One listener, attached once when the portal loads, so you can receive a
// call from anyone at any time while the app is open.
function listenForIncomingCalls() {
    if (!currentUser || !currentUser.uid) return;
    db.ref(`incomingCalls/${currentUser.uid}`).on('child_added', snap => {
        const call = snap.val();
        const callId = snap.key;
        if (!call) return;

        if (pendingIncomingCall || currentCallId) {
            // Already on a call or already have a pending ring — decline automatically.
            db.ref(`calls/${callId}/status`).set('declined').catch(() => {});
            db.ref(`incomingCalls/${currentUser.uid}/${callId}`).remove().catch(() => {});
            return;
        }

        pendingIncomingCall = { callId, ...call };
        document.getElementById('icAv').src = call.callerAvatar || '';
        document.getElementById('icNm').innerText = call.callerName || 'Someone';
        document.getElementById('icType').innerText = call.type === 'video' ? 'Incoming video call...' : 'Incoming audio call...';
        openMo('incomingCallMo');

        // If the caller hangs up before we answer, close the ringing modal.
        const statusRef = db.ref(`calls/${callId}/status`);
        statusRef.on('value', s => {
            if (s.val() === 'ended' && pendingIncomingCall && pendingIncomingCall.callId === callId) {
                closeMo('incomingCallMo');
                statusRef.off('value');
                db.ref(`incomingCalls/${currentUser.uid}/${callId}`).remove().catch(() => {});
                pendingIncomingCall = null;
                showToast('📵 Missed call');
            }
        });
    });
}

async function createPeerConnection(callId, isCaller) {
    const iceConfig = await getIceServers();
    pc = new RTCPeerConnection(iceConfig);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const remoteStream = new MediaStream();
    const remoteVideoEl = document.getElementById('clRemoteVideo');
    const remoteAudioEl = document.getElementById('clRemoteAudio');
    remoteVideoEl.srcObject = remoteStream;
    remoteAudioEl.srcObject = remoteStream;

    pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    const candidatePath = isCaller ? `calls/${callId}/callerCandidates` : `calls/${callId}/calleeCandidates`;
    pc.onicecandidate = (event) => {
        if (event.candidate) db.ref(candidatePath).push(event.candidate.toJSON());
    };

    pc.onconnectionstatechange = () => {
        if (pc && pc.connectionState === 'connected') {
            document.getElementById('clStatus').style.display = 'none';
            document.getElementById('clAudStatus').innerText = 'Connected';
            remoteVideoEl.style.display = 'block';
            startCallBillingTimer();
            startServerBilling(callId);
        }
    };
}

function resetCallUI() {
    document.getElementById('clStatus').style.display = 'flex';
    document.getElementById('clStatus').innerText = 'Calling...';
    document.getElementById('clAudStatus').innerText = 'Calling...';
    document.getElementById('clRemoteVideo').style.display = 'none';
}

// ---- CALLER SIDE ----
async function initiateCall(targetUid, targetName, targetAvatar, type) {
    if (!currentUser) { showToast('⚠️ Please log in first'); return; }
    history.pushState({ modal: 'call' }, '');
    callType = type;
    resetCallUI();
    document.getElementById('clNm').innerText = targetName || 'Calling...';
    document.getElementById('clAudAv').src = targetAvatar || '';
    document.getElementById('clCoins').innerText = coins;
    if (type === 'video') {
        document.getElementById('clVidUI').style.display = 'flex';
        document.getElementById('clAudUI').style.display = 'none';
    } else {
        document.getElementById('clVidUI').style.display = 'none';
        document.getElementById('clAudUI').style.display = 'flex';
    }
    openMo('callMo');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    } catch (e) {
        showToast('⚠️ Camera/Mic permission needed');
        closeMo('callMo');
        return;
    }
    if (type === 'video') document.getElementById('clLocal').srcObject = localStream;

    const callId = db.ref('calls').push().key;
    currentCallId = callId;
    currentCallRole = 'caller';

    await createPeerConnection(callId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await db.ref(`calls/${callId}`).set({
        callerId: currentUser.uid,
        callerName: currentUser.name,
        callerAvatar: currentUser.avatar || '',
        calleeId: targetUid,
        type: type,
        status: 'ringing',
        offer: { sdp: offer.sdp, type: offer.type },
        createdAt: Date.now()
    });
    await db.ref(`incomingCalls/${targetUid}/${callId}`).set({
        callerId: currentUser.uid,
        callerName: currentUser.name,
        callerAvatar: currentUser.avatar || '',
        type: type,
        timestamp: Date.now()
    });

    const answerRef = db.ref(`calls/${callId}/answer`);
    answerRef.on('value', async snap => {
        const answer = snap.val();
        if (answer && pc && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });
    trackCallListener(answerRef, 'value');

    const calleeCandRef = db.ref(`calls/${callId}/calleeCandidates`);
    calleeCandRef.on('child_added', snap => {
        if (pc) pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(() => {});
    });
    trackCallListener(calleeCandRef, 'child_added');

    const statusRef = db.ref(`calls/${callId}/status`);
    statusRef.on('value', snap => {
        const status = snap.val();
        if (status === 'declined') { showToast('📵 Call declined'); endCall(true); }
    });
    trackCallListener(statusRef, 'value');
}

// Called from the chat header call buttons.
function callUser(type) {
    if (!activeChatUser) return;
    initiateCall(activeChatUser.id, activeChatUser.name.split(',')[0], activeChatUser.avatar, type);
}

// Auto Match now reuses the same real call flow — it just calls a random
// online (non-blocked) member and starts a normal video call with them.
function startAutoMatch() {
    const candidates = onlineUsers.filter(u => u.id && u.id !== currentUser?.uid);
    if (candidates.length === 0) { showToast('⚠️ No one else is online right now'); return; }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    initiateCall(target.id, `Auto Match — ${target.name.split(',')[0]}`, target.avatar, 'video');
}

// ---- CALLEE SIDE ----
async function acceptIncomingCall() {
    if (!pendingIncomingCall) return;
    const { callId, callerId, callerName, callerAvatar, type } = pendingIncomingCall;
    closeMo('incomingCallMo');
    db.ref(`incomingCalls/${currentUser.uid}/${callId}`).remove().catch(() => {});

    history.pushState({ modal: 'call' }, '');
    callType = type;
    resetCallUI();
    document.getElementById('clNm').innerText = callerName || 'Someone';
    document.getElementById('clAudAv').src = callerAvatar || '';
    document.getElementById('clCoins').innerText = coins;
    if (type === 'video') {
        document.getElementById('clVidUI').style.display = 'flex';
        document.getElementById('clAudUI').style.display = 'none';
    } else {
        document.getElementById('clVidUI').style.display = 'none';
        document.getElementById('clAudUI').style.display = 'flex';
    }
    openMo('callMo');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    } catch (e) {
        showToast('⚠️ Camera/Mic permission needed');
        await db.ref(`calls/${callId}/status`).set('declined');
        closeMo('callMo');
        pendingIncomingCall = null;
        return;
    }
    if (type === 'video') document.getElementById('clLocal').srcObject = localStream;

    currentCallId = callId;
    currentCallRole = 'callee';
    pendingIncomingCall = null;

    await createPeerConnection(callId, false);

    const offerSnap = await db.ref(`calls/${callId}/offer`).once('value');
    const offer = offerSnap.val();
    if (!offer) { showToast('⚠️ Call is no longer available'); closeCall(); return; }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await db.ref(`calls/${callId}/answer`).set({ sdp: answer.sdp, type: answer.type });
    await db.ref(`calls/${callId}/status`).set('accepted');

    const callerCandRef = db.ref(`calls/${callId}/callerCandidates`);
    callerCandRef.on('child_added', snap => {
        if (pc) pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(() => {});
    });
    trackCallListener(callerCandRef, 'child_added');

    const statusRef = db.ref(`calls/${callId}/status`);
    statusRef.on('value', snap => {
        if (snap.val() === 'ended') endCall(true);
    });
    trackCallListener(statusRef, 'value');
}

function declineIncomingCall() {
    if (!pendingIncomingCall) return;
    const { callId } = pendingIncomingCall;
    db.ref(`calls/${callId}/status`).set('declined').catch(() => {});
    db.ref(`incomingCalls/${currentUser.uid}/${callId}`).remove().catch(() => {});
    pendingIncomingCall = null;
    closeMo('incomingCallMo');
}

// ---- SHARED: BILLING + HANGUP ----
// The on-screen clock below is purely cosmetic. The REAL billing happens
// via startServerBilling(), which pings /api/bill-call-minute — that
// endpoint independently tracks when the call connected and how many
// minutes have really elapsed, and is the only thing that actually
// deducts coins (see that file for details).
let callBillingApiTimer = null;

function startCallBillingTimer() {
    callSecs = 0;
    clearInterval(callBillingTimer);
    callBillingTimer = setInterval(() => {
        callSecs++;
        const m = Math.floor(callSecs / 60), s = callSecs % 60;
        document.getElementById('clTimer').innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
}

async function pingCallBilling(callId) {
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/bill-call-minute', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId })
        });
        const data = await resp.json();

        if (resp.status === 402) {
            coins = data.newCoinBalance ?? coins;
            currentUser.coins = coins;
            document.getElementById('navC').innerText = coins;
            document.getElementById('clCoins').innerText = coins;
            showToast('🚨 Out of coins — ending call');
            endCall(false);
            return;
        }
        if (!resp.ok) return; // transient error — just skip this tick

        if (typeof data.newCoinBalance === 'number') {
            coins = data.newCoinBalance;
            currentUser.coins = coins;
            document.getElementById('navC').innerText = coins;
            document.getElementById('clCoins').innerText = coins;
            if (data.billed > 0) showToast(`🪙 -${data.billed} for call time`);
        }
    } catch (err) {
        // network hiccup — don't end the call over one failed billing ping
    }
}

function startServerBilling(callId) {
    clearInterval(callBillingApiTimer);
    pingCallBilling(callId); // immediate ping: establishes connectedAt, bills nothing yet
    callBillingApiTimer = setInterval(() => pingCallBilling(callId), 60000);
}

function endCall(remoteEnded) {
    clearInterval(callBillingTimer);
    clearInterval(callBillingApiTimer);
    detachCallListeners();
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }

    if (currentCallId && !remoteEnded) {
        db.ref(`calls/${currentCallId}/status`).set('ended').catch(() => {});
    }
    currentCallId = null;
    currentCallRole = null;
    closeMo('callMo');
}

function closeCall() { endCall(false); }
function closeAutoCall() { endCall(false); } // kept for any lingering references; Auto Match now uses closeCall()

function openEdit2() { openMo('editMo'); }
function openReg() { history.pushState({ modal: 'reg' }, ''); openMo('regMo'); }
function openMo(id) { document.getElementById(id).classList.add('open'); }
function closeMo(id) { document.getElementById(id).classList.remove('open'); }

function toggleDD(e) { if (e) e.stopPropagation(); document.getElementById('navDD').classList.toggle('show'); }
function closeDD() { document.getElementById('navDD').classList.remove('show'); }
document.addEventListener('click', e => { if (!e.target.closest('.menu-anchor')) closeDD(); });

// ---- AUTH: REGISTER / LOGIN / LOGOUT ----
async function submitReg() {
    const name = document.getElementById('rNm').value.trim().slice(0, 60);
    const dobStr = document.getElementById('rDob').value;
    const gender = document.getElementById('rGen').value;
    const email = document.getElementById('rMail').value.trim();
    const password = document.getElementById('rPass').value;

    if (!name) { showToast("⚠️ Enter your name"); return; }
    if (!dobStr) { showToast("⚠️ Enter your date of birth"); return; }

    const dob = new Date(dobStr + 'T00:00:00');
    if (isNaN(dob.getTime()) || dob > new Date()) { showToast("⚠️ Enter a valid date of birth"); return; }

    // Compute exact age from the birth date rather than trusting a
    // self-typed number — still self-reported (not ID-verified), but this
    // at least keeps the stored age internally consistent with the DOB.
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hasHadBirthdayThisYear = (today.getMonth() > dob.getMonth()) ||
        (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hasHadBirthdayThisYear) age--;

    if (age < 18) { showToast("⚠️ Must be 18+!"); return; }
    if (!email) { showToast("⚠️ Enter a valid email"); return; }
    if (!password || password.length < 6) { showToast("⚠️ Password must be 6+ characters"); return; }
    if (!document.getElementById('rAgree').checked) { showToast("⚠️ Please agree to the Terms & Privacy Policy"); return; }

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        const newProfile = {
            id: uid,
            name: name,
            age: age,
            dob: dobStr,
            gender: gender,
            city: 'Dhaka',
            coins: 50,
            vip: false,
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop',
            bio: '',
            createdAt: Date.now()
        };
        await db.ref('users/' + uid).set(newProfile);
        cred.user.sendEmailVerification().catch(() => {}); // non-fatal if it fails
        closeMo('regMo');
        showToast("🎉 Account created! Check your email to verify it.");
        // onAuthStateChanged fires automatically and loads the portal
    } catch (err) {
        showToast("⚠️ " + (err.message || "Registration failed"));
    }
}

async function submitLogin() {
    const email = document.getElementById('lMail').value.trim();
    const password = document.getElementById('lPass').value;
    if (!email || !password) { showToast("⚠️ Enter email and password"); return; }
    try {
        await auth.signInWithEmailAndPassword(email, password);
        closeMo('loginMo');
    } catch (err) {
        showToast("⚠️ Login failed — check your email/password");
    }
}

// Uses Firebase Authentication's built-in password reset — Firebase sends
// the email and hosts the actual "set a new password" page itself, so no
// custom backend code is needed for this to work securely.
async function submitPasswordReset() {
    const email = document.getElementById('fMail').value.trim();
    if (!email) { showToast("⚠️ Enter your email"); return; }
    try {
        await auth.sendPasswordResetEmail(email);
        showToast("📧 Reset link sent — check your email");
        closeMo('forgotMo');
    } catch (err) {
        // Deliberately vague error message — confirming/denying whether an
        // email is registered would let someone enumerate real accounts.
        showToast("📧 If that email is registered, a reset link has been sent");
        closeMo('forgotMo');
    }
}

async function confirmDeleteAccount() {
    const confirmText = document.getElementById('deleteConfirmInput').value.trim();
    if (confirmText !== 'DELETE') { showToast('⚠️ Type DELETE to confirm'); return; }
    if (!currentUser) return;

    showToast('⏳ Deleting your account...');
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/delete-account', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken }
        });
        const data = await resp.json();
        if (!resp.ok) {
            showToast('⚠️ ' + (data.error || 'Could not delete account'));
            return;
        }
        closeMo('deleteAccountMo');
        // The account no longer exists server-side — sign out locally too.
        auth.signOut().then(() => location.reload());
    } catch (err) {
        showToast('⚠️ Network error — try again');
    }
}

async function resendVerificationEmail() {
    if (!auth.currentUser) return;
    try {
        await auth.currentUser.sendEmailVerification();
        showToast('📧 Verification email sent');
    } catch (err) {
        showToast('⚠️ Could not send — try again later');
    }
}

function logout() {
    auth.signOut().then(() => location.reload());
}

// ---- TASKS ----
function renderTasks() {
    const box = document.getElementById('tasksBox');
    const taskKeys = ['login', 'profile', 'messages', 'likes', 'watchad', 'visit3', 'passport', 'sendgift'];
    box.innerHTML = taskKeys.map(key => {
        const t = dailyTasks[key];
        if (!t) return ''; // defensive: never let one bad/missing entry blank the whole list
        const pct = Math.min((t.progress / t.target) * 100, 100);
        const done = t.progress >= t.target;
        return `
            <div class="task-card ${t.claimed ? 'completed' : ''}">
                <div class="task-icon"><i class="fas ${t.icon}"></i></div>
                <div class="task-info">
                    <h4>${t.title}</h4>
                    <p>${t.desc} (${Math.min(t.progress, t.target)}/${t.target})</p>
                    <div class="task-progress"><div class="task-progress-fill" style="width:${pct}%"></div></div>
                </div>
                ${t.claimed ? '<span style="color:#00c853;font-size:11px;font-weight:700;">✓ Done</span>' :
                done ? `<button class="task-claim-btn" onclick="claimTask('${key}')">+${t.reward} 🪙</button>` :
                    `<span class="task-reward">+${t.reward} 🪙</span>`}
            </div>
        `;
    }).join('');
}

function updateTaskProgress(taskId, amt) {
    if (!dailyTasks[taskId] || dailyTasks[taskId].claimed) return;
    dailyTasks[taskId].progress = Math.min(dailyTasks[taskId].progress + amt, dailyTasks[taskId].target);
    localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));
    renderTasks();
}

// Calls our secure /api/claim-task endpoint, which independently checks the
// REAL database data (messages sent, likes recorded, bio saved) before
// paying out — it never trusts the progress numbers shown in this browser.
async function claimTask(taskId) {
    const t = dailyTasks[taskId];
    if (!t || t.claimed) return;

    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/claim-task', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + idToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskId })
        });
        const data = await resp.json();

        if (!resp.ok) {
            // Server disagrees that this task is complete (or already claimed).
            // Re-sync the local progress bar to match reality.
            if (typeof data.progress === 'number') {
                dailyTasks[taskId].progress = data.progress;
                localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));
                renderTasks();
            }
            showToast('⚠️ ' + (data.error || 'Could not claim reward'));
            return;
        }

        dailyTasks[taskId].claimed = true;
        localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));
        coins = data.newCoinBalance;
        currentUser.coins = coins;
        document.getElementById('navC').innerText = coins;
        renderTasks();
        showToast(`🪙 +${data.reward} Coins claimed!`);
    } catch (err) {
        showToast('⚠️ Network error — try again');
    }
}

// ---- ADS ----
let adTimer = null;
let adCountdownDone = false; // only true once the full duration has actually elapsed

function showAd(cb, duration = null) {
    if (vip) { if (cb) cb(); return; }
    adCountdownDone = false;
    document.getElementById('adOv').classList.add('show');
    document.getElementById('adSk').classList.remove('visible');
    document.getElementById('adContinueBtn').style.display = 'none';
    let cd = duration || (Math.floor(Math.random() * 6) + 5);
    document.getElementById('adTm').innerText = cd;
    clearInterval(adTimer);
    adTimer = setInterval(() => {
        cd--;
        document.getElementById('adTm').innerText = cd;
        if (cd <= 0) {
            clearInterval(adTimer);
            adCountdownDone = true;
            document.getElementById('adSk').classList.add('visible');
            document.getElementById('adContinueBtn').style.display = 'inline-flex';
        }
    }, 1000);
    window._adCb = cb || null;
}

function closeAd() {
    // This is the fix for the "claim reward before the ad finishes" bug:
    // closing early now just dismisses the ad with NO reward. The callback
    // (which is what actually credits coins / unlocks the next action) only
    // ever runs if the countdown genuinely reached zero.
    document.getElementById('adOv').classList.remove('show');
    clearInterval(adTimer);
    if (!adCountdownDone) {
        window._adCb = null;
        return;
    }
    if (window._adCb) { window._adCb(); window._adCb = null; }
}

// Calls /api/watch-ad and applies the result to the UI. Returns the response
// data on success, or null on failure (after showing an error toast) — used
// both by the Daily Tasks "Watch Ad" button and by Lucky Spin's bonus spins,
// so every ad watch anywhere in the app goes through the same real, counted
// server record (adWatchLog) rather than each feature tracking it separately.
async function watchAdAndCreditCoins() {
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/watch-ad', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' }
        });
        const data = await resp.json();
        if (!resp.ok) {
            showToast('⚠️ ' + (data.error || 'Could not credit coins'));
            return null;
        }
        coins = data.newCoinBalance;
        currentUser.coins = coins;
        document.getElementById('navC').innerText = coins;
        document.getElementById('adsW').innerText = data.adsWatchedToday;
        document.getElementById('adsE').innerText = data.adsWatchedToday * 2;
        updateTaskProgress('watchad', 1);
        return data;
    } catch (err) {
        showToast("⚠️ Network error — try again");
        return null;
    }
}

// This calls our own secure server endpoint (/api/watch-ad) instead of
// touching the coins field directly — the database rules block direct
// client writes to /coins, and that's intentional (see database.rules.json).
// The server verifies the user's identity and credits coins safely.
async function watchAd() {
    if (!currentUser) { showToast("⚠️ Please log in first"); return; }
    showAd(async () => {
        const data = await watchAdAndCreditCoins();
        if (data) showToast(`🪙 +2 Coins credited!`);
    }, 6);
}

function showToast(m) {
    document.getElementById('toastT').innerText = m; // innerText — safe even if m ever contains user data
    document.getElementById('toast').classList.add('show');
    setTimeout(() => document.getElementById('toast').classList.remove('show'), 3000);
}

function goHome() {
    if (currentUser) switchV('swipeDeck', document.getElementById('bbtn-swipeDeck'));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setPassportCity(city) {
    if (!currentUser) return;
    currentUser.city = city;
    document.getElementById('currentPassportLocation').innerText = `Current Location: ${city}`;
    syncWithFirebase();
    const today = new Date().toISOString().slice(0, 10);
    db.ref(`passportLog/${currentUser.uid}/${today}`).set(true).catch(() => {});
    updateTaskProgress('passport', 1);
    showToast(`✈️ Passport set to ${city}`);
}

const MAX_BONUS_SPINS = 5;
let spinInProgress = false;

function playSpinAnimation(onDone) {
    const wheel = document.getElementById('spinW');
    const deg = 1440 + Math.floor(Math.random() * 360);
    wheel.style.transform = `rotate(${deg}deg)`;
    setTimeout(() => { if (onDone) onDone(); }, 4200);
}

function updateSpinUI() {
    const freeBtn = document.getElementById('spinBtn');
    const bonusBtn = document.getElementById('bonusSpinBtn');
    const status = document.getElementById('spinSt');

    if (!spD.free) {
        freeBtn.style.display = 'inline-flex';
        freeBtn.disabled = spinInProgress;
        bonusBtn.style.display = 'none';
        status.innerText = spinInProgress ? 'Spinning...' : '1 Free spin available today!';
    } else if (spD.extra < MAX_BONUS_SPINS) {
        freeBtn.style.display = 'none';
        bonusBtn.style.display = 'inline-flex';
        bonusBtn.disabled = spinInProgress;
        bonusBtn.style.opacity = spinInProgress ? '0.7' : '1';
        status.innerText = spinInProgress ? 'Spinning...' : `Bonus spins used: ${spD.extra}/${MAX_BONUS_SPINS} — watch an ad for another`;
    } else {
        freeBtn.style.display = 'none';
        bonusBtn.style.display = 'inline-flex';
        bonusBtn.disabled = true;
        bonusBtn.style.opacity = '0.4';
        status.innerText = `All spins used today (1 free + ${MAX_BONUS_SPINS} bonus) — come back tomorrow!`;
    }
}

// Calls our secure /api/spin endpoint, which decides BOTH whether a spin is
// allowed (based on real ad-watch data) and the prize amount — the wheel
// animation here is purely cosmetic. `onAllowed` lets the caller update the
// local (UI-only) spD tracker once the server actually confirms the spin.
async function performServerSpin(onAllowed) {
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/spin', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' }
        });
        const data = await resp.json();

        if (!resp.ok) {
            showToast('⚠️ ' + (data.error || 'No spins available'));
            spinInProgress = false;
            updateSpinUI();
            return;
        }

        playSpinAnimation(() => {
            coins = data.newCoinBalance;
            currentUser.coins = coins;
            document.getElementById('navC').innerText = coins;
            onAllowed();
            localStorage.setItem('meylo_spin', JSON.stringify(spD));
            showToast(`🎉 You won ${data.prizeCoins} coins!`);
            spinInProgress = false;
            updateSpinUI();
        });
    } catch (err) {
        showToast('⚠️ Network error — try again');
        spinInProgress = false;
        updateSpinUI();
    }
}

function doSpin() {
    if (spinInProgress) return;
    if (spD.free) { showToast("⏳ Use a bonus spin by watching an ad, or come back tomorrow!"); return; }
    spinInProgress = true;
    updateSpinUI();
    performServerSpin(() => { spD.free = true; });
}

function doBonusSpin() {
    if (spinInProgress) return;
    if (!spD.free) { showToast("⚠️ Use your free spin first!"); return; }
    if (spD.extra >= MAX_BONUS_SPINS) { showToast("⏳ No bonus spins left today — come back tomorrow!"); return; }
    spinInProgress = true;
    updateSpinUI();

    // The spin request only fires AFTER the ad genuinely finishes — showAd()
    // only calls this callback once the countdown has actually completed
    // (see the closeAd() early-exit guard). Watching the ad here uses the
    // same real, server-logged ad watch as the Daily Tasks button, which is
    // exactly what /api/spin checks to decide if a bonus spin is unlocked.
    showAd(async () => {
        const adResult = await watchAdAndCreditCoins();
        if (!adResult) { spinInProgress = false; updateSpinUI(); return; }
        performServerSpin(() => { spD.extra++; });
    }, 6);
}

// ---- BOOST ----
let boostBannerInterval = null;

function openBoostModal() {
    history.pushState({ modal: 'boost' }, '');
    const activeUntil = currentUser && currentUser.boostedUntil;
    const stillActive = activeUntil && Date.now() < activeUntil;
    document.getElementById('boostAlreadyActive').style.display = stillActive ? 'block' : 'none';
    document.getElementById('activateBoostBtn').innerText = stillActive ? 'Extend +30 min — 🪙 50' : '';
    if (!stillActive) document.getElementById('activateBoostBtn').innerHTML = '<i class="fas fa-bolt"></i> Activate — 🪙 50';
    else document.getElementById('activateBoostBtn').innerHTML = '<i class="fas fa-bolt"></i> Extend +30 min — 🪙 50';
    openMo('boostMo');
}

async function activateBoost() {
    if (!currentUser) return;
    try {
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('/api/boost', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' }
        });
        const data = await resp.json();
        if (!resp.ok) { showToast('⚠️ ' + (data.error || 'Could not activate boost')); return; }

        coins = data.newCoinBalance;
        currentUser.coins = coins;
        currentUser.boostedUntil = data.boostedUntil;
        document.getElementById('navC').innerText = coins;
        closeMo('boostMo');
        showToast('🚀 Boost activated for 30 minutes!');
        updateBoostBanner();
    } catch (err) {
        showToast('⚠️ Network error — try again');
    }
}

function updateBoostBanner() {
    const banner = document.getElementById('boostActiveBanner');
    const timeLeftEl = document.getElementById('boostTimeLeft');
    clearInterval(boostBannerInterval);

    const tick = () => {
        const remaining = (currentUser?.boostedUntil || 0) - Date.now();
        if (remaining <= 0) {
            banner.style.display = 'none';
            clearInterval(boostBannerInterval);
            return;
        }
        banner.style.display = 'flex';
        const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
        timeLeftEl.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
    };
    tick();
    boostBannerInterval = setInterval(tick, 1000);
}
