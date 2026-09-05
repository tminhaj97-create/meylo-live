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

let dailyTasks = JSON.parse(localStorage.getItem('meylo_tasks')) || {
    date: todayStr,
    login: { progress: 1, target: 1, claimed: false, reward: 5, icon: 'fa-calendar-check', title: 'Daily Login', desc: 'Open Meylo daily' },
    profile: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-user-edit', title: 'Complete Profile', desc: 'Set your profile bio' },
    messages: { progress: 0, target: 3, claimed: false, reward: 5, icon: 'fa-paper-plane', title: 'Send 3 Messages', desc: 'Chat with matches' },
    likes: { progress: 0, target: 5, claimed: false, reward: 5, icon: 'fa-heart', title: 'Like 5 Profiles', desc: 'Swipe on discover' },
    watchad: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-ad', title: 'Watch 1 Ad', desc: 'Watch a video ad' }
};
if (dailyTasks.date !== todayStr) {
    dailyTasks = {
        date: todayStr,
        login: { progress: 1, target: 1, claimed: false, reward: 5, icon: 'fa-calendar-check', title: 'Daily Login', desc: 'Open Meylo daily' },
        profile: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-user-edit', title: 'Complete Profile', desc: 'Set your profile bio' },
        messages: { progress: 0, target: 3, claimed: false, reward: 5, icon: 'fa-paper-plane', title: 'Send 3 Messages', desc: 'Chat with matches' },
        likes: { progress: 0, target: 5, claimed: false, reward: 5, icon: 'fa-heart', title: 'Like 5 Profiles', desc: 'Swipe on discover' },
        watchad: { progress: 0, target: 1, claimed: false, reward: 5, icon: 'fa-ad', title: 'Watch 1 Ad', desc: 'Watch a video ad' }
    };
    localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));
}

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
                vip = currentUser.vip || false;
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
            lastSeen: Date.now()
        });
    }

    db.ref('users').on('value', snapshot => {
        const data = snapshot.val();
        onlineUsers = [];
        if (data) {
            Object.keys(data).forEach(key => {
                if (!currentUser || key !== currentUser.uid) {
                    onlineUsers.push(data[key]);
                }
            });
        }
        if (onlineUsers.length === 0) {
            onlineUsers = [
                { id: 'sample1', name: 'Jessica, 22', city: 'London, UK', age: 22, gender: 'female', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop', gallery: ['https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop'], bio: 'Coffee & music lover.', height: "5'6\"", body: "Slim", zodiac: "Leo", occupation: "Designer", interests: ["🎵 Music", "☕ Coffee", "🎨 Art"] },
                { id: 'sample2', name: 'Sophia, 24', city: 'New York, USA', age: 24, gender: 'female', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop', gallery: ['https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop'], bio: 'Tech geek & world traveler.', height: "5'8\"", body: "Athletic", zodiac: "Virgo", occupation: "Engineer", interests: ["✈️ Travel", "📸 Photography"] }
            ];
        }
        loadCard();
        renderMatches();
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
        updateTaskProgress('likes', 1);
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
                // CRITICAL: message text is user-typed — always escape before innerHTML
                msgsBox.innerHTML += `<div class="chat-bubble ${isMe ? 'outgoing' : 'incoming'}">${escapeHTML(msg.text)}</div>`;
            });
            msgsBox.scrollTop = msgsBox.scrollHeight;
        } else {
            msgsBox.innerHTML = '<div style="text-align:center;color:#666;font-size:12px;margin-top:20px">Say hello to start conversation! 👋</div>';
        }
    });
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
    document.getElementById('vNm').innerHTML = `${escapeHTML(p.name)} <i class="fas fa-check-circle vbi"></i>`;
    document.getElementById('vSub').innerText = `📍 ${p.city || 'Global'}`;
    document.getElementById('vBio').innerText = p.bio || 'No bio added.';
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
    openMo('editMo');
}

function saveProf() {
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

    renderProf(); closeMo('editMo');
    syncWithFirebase();
    updateTaskProgress('profile', 1);
    showToast("✅ Profile Saved!");
}

// ---- PAYMENTS ----
// The old code here simulated bKash/Nagad/card/PayPal checkouts and even
// displayed the "OTP" to the user in an alert() — none of it moved real
// money or talked to a real payment processor. That is misleading to real
// users and is now disabled. Store/VIP buttons are marked "Coming Soon"
// in index.html until a real, licensed payment processor (and a backend
// Cloud Function to credit coins after a *verified* payment) is wired up.
function openPay() {
    showToast("💳 Payments are being set up with a real provider — coming soon!");
}

// ---- AUTO MATCH VIDEO CALL ----
let acStream = null, acTimer = null, acSec = 0;
function startAutoMatch() {
    history.pushState({ modal: 'autoCall' }, '');
    const rand = onlineUsers[Math.floor(Math.random() * onlineUsers.length)] || { name: 'Match', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=500&h=700&fit=crop' };
    document.getElementById('acNm').innerText = `Live with ${rand.name.split(',')[0]}`;
    document.getElementById('acRemote').src = rand.avatar;
    openMo('autoCallMo');
    startAcCam();
}

async function startAcCam() {
    try {
        acStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('acLocal').srcObject = acStream;
        acSec = 0;
        acTimer = setInterval(() => {
            acSec++;
            let m = Math.floor(acSec / 60), s = acSec % 60;
            document.getElementById('acTimer').innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
            if (acSec > 30 && (acSec - 30) % 60 === 1) {
                if (coins >= 15) {
                    showToast("🪙 This call uses coins — balance changes are verified server-side.");
                } else {
                    showToast("🚨 Out of coins!");
                    closeAutoCall();
                }
            }
        }, 1000);
    } catch (e) { showToast("⚠️ Camera/Mic error"); closeAutoCall(); }
}

function closeAutoCall() {
    clearInterval(acTimer);
    if (acStream) acStream.getTracks().forEach(t => t.stop());
    closeMo('autoCallMo');
    showAd(null, Math.floor(Math.random() * 6) + 5);
}

// ---- REGULAR CALL ----
let clTimer = null, clSecs = 0, clStream = null, clType = 'video';
function callUser(type) {
    if (!activeChatUser) return;
    openCallModal(activeChatUser, type);
}

function openCallModal(p, type) {
    history.pushState({ modal: 'call' }, '');
    showAd(() => {
        clType = type;
        document.getElementById('clNm').innerText = `Live with ${p.name.split(',')[0]}`;
        const pic = p.avatar || '';
        if (type === 'video') {
            document.getElementById('clVidUI').style.display = 'flex';
            document.getElementById('clAudUI').style.display = 'none';
            document.getElementById('clRemote').src = pic;
        } else {
            document.getElementById('clVidUI').style.display = 'none';
            document.getElementById('clAudUI').style.display = 'flex';
            document.getElementById('clAudAv').src = pic;
        }
        openMo('callMo');
        startCallMedia();
    });
}

async function startCallMedia() {
    try {
        clStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: (clType === 'video') });
        if (clType === 'video') document.getElementById('clLocal').srcObject = clStream;
        clSecs = 0;
        document.getElementById('clTimer').innerText = "00:00";
        document.getElementById('clCoins').innerText = coins;
        clTimer = setInterval(() => {
            clSecs++;
            let m = Math.floor(clSecs / 60), s = clSecs % 60;
            document.getElementById('clTimer').innerText = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
        }, 1000);
    } catch (e) { showToast("⚠️ Device error"); closeCall(); }
}

function closeCall() {
    clearInterval(clTimer);
    if (clStream) clStream.getTracks().forEach(t => t.stop());
    closeMo('callMo');
    showAd(null, Math.floor(Math.random() * 6) + 5);
}

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
    const age = parseInt(document.getElementById('rAge').value);
    const gender = document.getElementById('rGen').value;
    const email = document.getElementById('rMail').value.trim();
    const password = document.getElementById('rPass').value;

    if (!name) { showToast("⚠️ Enter your name"); return; }
    if (isNaN(age) || age < 18) { showToast("⚠️ Must be 18+!"); return; }
    if (!email) { showToast("⚠️ Enter a valid email"); return; }
    if (!password || password.length < 6) { showToast("⚠️ Password must be 6+ characters"); return; }

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        const newProfile = {
            id: uid,
            name: name,
            age: age,
            gender: gender,
            city: 'Dhaka',
            coins: 50,
            vip: false,
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&h=700&fit=crop',
            bio: '',
            createdAt: Date.now()
        };
        await db.ref('users/' + uid).set(newProfile);
        closeMo('regMo');
        showToast("🎉 Account created!");
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

function logout() {
    auth.signOut().then(() => location.reload());
}

// ---- TASKS ----
function renderTasks() {
    const box = document.getElementById('tasksBox');
    const taskKeys = ['login', 'profile', 'messages', 'likes', 'watchad'];
    box.innerHTML = taskKeys.map(key => {
        const t = dailyTasks[key];
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

// NOTE: like the coin store, claiming coin rewards from tasks should really
// happen via a Cloud Function that checks task completion server-side and
// then increments /users/$uid/coins itself. Client-side coin writes are
// blocked by database.rules.json, so this local increment is for UI/demo
// purposes only until that function exists — it will not persist to coins
// in the database.
function claimTask(taskId) {
    const t = dailyTasks[taskId];
    if (t && !t.claimed && t.progress >= t.target) {
        t.claimed = true;
        localStorage.setItem('meylo_tasks', JSON.stringify(dailyTasks));
        renderTasks();
        showToast(`🪙 Reward queued — coins are credited by our server once task verification is live.`);
    }
}

// ---- ADS ----
let adTimer = null;
function showAd(cb, duration = null) {
    if (vip) { if (cb) cb(); return; }
    document.getElementById('adOv').classList.add('show');
    document.getElementById('adSk').classList.remove('visible');
    let cd = duration || (Math.floor(Math.random() * 6) + 5);
    document.getElementById('adTm').innerText = cd;
    clearInterval(adTimer);
    adTimer = setInterval(() => {
        cd--;
        document.getElementById('adTm').innerText = cd;
        if (cd <= 0) {
            clearInterval(adTimer);
            document.getElementById('adSk').classList.add('visible');
        }
    }, 1000);
    window._adCb = cb || null;
}

function closeAd() {
    clearInterval(adTimer);
    document.getElementById('adOv').classList.remove('show');
    if (window._adCb) { window._adCb(); window._adCb = null; }
}

function watchAd() {
    showAd(() => {
        adD.c++;
        localStorage.setItem('meylo_ad_watch', JSON.stringify(adD));
        document.getElementById('adsW').innerText = adD.c;
        document.getElementById('adsE').innerText = adD.c * 2;
        updateTaskProgress('watchad', 1);
        showToast("🪙 Ad watched — reward will be credited by our server.");
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
    showToast(`✈️ Passport set to ${city}`);
}

function doSpin() {
    if (spD.free) { showToast("⏳ Come back tomorrow for a free spin!"); return; }
    const wheel = document.getElementById('spinW');
    const deg = 1440 + Math.floor(Math.random() * 360);
    wheel.style.transform = `rotate(${deg}deg)`;
    spD.free = true;
    localStorage.setItem('meylo_spin', JSON.stringify(spD));
    setTimeout(() => showToast("🎉 You won a prize! (server-verified rewards coming soon)"), 4200);
}

function openBoostModal() { showToast("🚀 Boost — coming soon once payments are live."); }
