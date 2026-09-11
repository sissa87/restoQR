// ============================================================================
// بوابة تسجيل دخول حقيقية لصفحات الموظفين - Supabase Auth الحقيقي
// الحسابات تُنشأ من Supabase Dashboard > Authentication > Users (خارج الموقع)
// الدور والقاعة يُحدَّدان من ملف profiles (يديره الآدمن/المدير من داخل الموقع)
// ============================================================================

const STAFF_ROLE_LABELS = {
  ADMIN: 'الآدمن', MANAGER: 'المسير', CASHIER: 'المحاسب',
  KITCHEN: 'شاشة المطبخ', MONITOR: 'مراقب القاعة', HALL_TV: 'شاشة القاعة (TV)'
};

let currentProfile = null;

// requiredRole: دور الصفحة المطلوب. ADMIN و MANAGER يدخلان أي صفحة موظفين دائماً.
async function requireStaffAuth(requiredRole, onSuccess) {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    const ok = await loadProfileAndCheck(session.user.id, requiredRole);
    if (ok) { injectLogoutButton(); onSuccess(); return; }
  }

  renderAuthGate(requiredRole, onSuccess);
}

async function loadProfileAndCheck(userId, requiredRole) {
  let { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();

  if (!profile) {
    // أول دخول لهذا الحساب: ننشئ سجل تعريف مبدئي بدون دور، ليظهر لدى الآدمن ويُفعَّل لاحقاً
    const { data: userData } = await supabaseClient.auth.getUser();
    const { data: created } = await supabaseClient.from('profiles')
      .insert({ id: userId, full_name: userData?.user?.email || null, role: null, is_active: true })
      .select().single();
    profile = created;
  }

  if (!profile || !profile.role || !profile.is_active) return false;
  // 🆕 فصل صلاحيات الآدمن عن المسير: الآدمن وحده يملك كل الصلاحيات (يدخل أي صفحة بلا استثناء،
  // بما فيها admin.html). المسير يدخل كل صفحات الموظفين التشغيلية (المحاسب/المراقب/المطبخ...)
  // + صفحته الخاصة manager.html، لكن لم يعد يدخل admin.html تلقائياً كما كان سابقاً.
  const isAdmin = profile.role === 'ADMIN';
  const isManagerOnNonAdminPage = profile.role === 'MANAGER' && requiredRole !== 'ADMIN';
  if (!(isAdmin || isManagerOnNonAdminPage || profile.role === requiredRole)) return false;
  currentProfile = profile;
  return true;
}

const HALL_SCREEN_ROLES = ['MONITOR', 'HALL_TV']; // الأدوار التي لها "شاشة قاعة" حسب السيناريو

function renderAuthGate(requiredRole, onSuccess) {
  const showHallQuickAccess = HALL_SCREEN_ROLES.includes(requiredRole);
  const overlay = document.createElement('div');
  overlay.id = 'authGateOverlay';
  overlay.className = 'fixed inset-0 z-[9999] bg-slate-950 flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="max-w-sm w-full card p-6 space-y-5">
      <div class="text-center space-y-2">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-amber-600 flex items-center justify-center text-2xl">🔒</div>
        <h2 class="font-extrabold text-white text-base">دخول موظفين - ${STAFF_ROLE_LABELS[requiredRole] || requiredRole}</h2>
        <p class="text-[11px] text-slate-400">سجّل بحساب موظف مُفعَّل من إدارة المطعم</p>
      </div>
      <div class="space-y-3">
        <input id="authEmail" type="email" placeholder="البريد الإلكتروني" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500" dir="ltr">
        <input id="authPassword" type="password" placeholder="كلمة المرور" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500">
        <label class="flex items-center gap-2 text-[11px] text-slate-400">
          <input id="rememberDeviceToggle" type="checkbox" class="w-3.5 h-3.5">
          🖥️ هذا جهاز يملكه المطعم - تذكرني (دخول سريع لاحقاً على هذا الجهاز فقط)
        </label>
        <button id="authLoginBtn" class="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold text-xs rounded-xl transition">🔓 دخول</button>
      </div>
      <div id="authError" class="text-xs text-rose-400 text-center"></div>
      ${showHallQuickAccess ? `
      <div class="border-t border-slate-800 pt-4 space-y-2">
        <button id="toggleHallQuickBtn" class="w-full text-[11px] text-amber-400 font-bold">🏛️ أو الدخول السريع بكود/كلمة مرور القاعة</button>
        <div id="hallQuickBox" class="space-y-2" style="display:none">
          <select id="hallQuickSelect" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"></select>
          <input id="hallQuickSecret" type="text" placeholder="كلمة مرور الشاشة أو الكود اليدوي للقاعة" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white" dir="ltr">
          <button id="hallQuickBtn" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs rounded-xl transition">🔓 دخول القاعة</button>
        </div>
      </div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('authLoginBtn').onclick = async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const remember = document.getElementById('rememberDeviceToggle').checked;
    if (!email || !password) { showAuthGateError('أدخل البريد وكلمة المرور'); return; }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) { showAuthGateError('البريد أو كلمة المرور غير صحيحة'); return; }

    const ok = await loadProfileAndCheck(data.session.user.id, requiredRole);
    if (!ok) {
      showAuthGateError('حسابك غير مفعّل أو لا يملك صلاحية الدخول لهذه الصفحة - تواصل مع الإدارة');
      await supabaseClient.auth.signOut();
      return;
    }

    if (remember) await registerTrustedDevice(data.session.user.id);

    overlay.remove();
    injectLogoutButton();
    onSuccess();
  };

  if (showHallQuickAccess) setupHallQuickAccess(overlay, onSuccess);
}

// تسجيل هذا الجهاز كـ"جهاز مطعم موثوق" - باختيار صريح من الموظف فقط، ودون تخزين
// كلمة المرور نفسها إطلاقاً (فقط سجل تدقيق يمكن للآدمن/المسير حذفه في أي وقت)
async function registerTrustedDevice(userId) {
  try {
    const deviceId = getDeviceId();
    await supabaseClient.from('trusted_devices')
      .upsert({ user_id: userId, device_id: deviceId, device_label: getDeviceInfo() }, { onConflict: 'user_id,device_id' });
  } catch (e) { console.error('registerTrustedDevice', e); }
}

// دخول سريع اختياري لشاشة القاعة عبر كلمة مرور الشاشة أو الكود اليدوي للقاعة
// (بديل إضافي لا يلغي حساب Supabase الكامل أعلاه - كما ينص السيناريو)
async function setupHallQuickAccess(overlay, onSuccess) {
  const toggleBtn = overlay.querySelector('#toggleHallQuickBtn');
  const box = overlay.querySelector('#hallQuickBox');
  const select = overlay.querySelector('#hallQuickSelect');
  toggleBtn.onclick = () => { box.style.display = box.style.display === 'none' ? 'block' : 'none'; };

  const { data: halls } = await supabaseClient.from('halls').select('id,name').eq('is_active', true);
  select.innerHTML = (halls || []).map(h => `<option value="${h.id}">${h.name}</option>`).join('');

  overlay.querySelector('#hallQuickBtn').onclick = async () => {
    const hallId = select.value;
    const secret = overlay.querySelector('#hallQuickSecret').value.trim();
    if (!hallId || !secret) { showAuthGateError('اختر القاعة وأدخل كلمة المرور أو الكود'); return; }
    const deviceId = getDeviceId(), deviceInfo = getDeviceInfo();

    let { data: pwdResult } = await supabaseClient.rpc('verify_hall_screen_password_secure', { p_hall_id: hallId, p_password: secret, p_device_id: deviceId, p_device_info: deviceInfo });
    if (!pwdResult || !pwdResult.isValid) {
      const { data: codeResult } = await supabaseClient.rpc('verify_hall_manual_code_secure', { p_hall_id: hallId, p_code: secret, p_device_id: deviceId, p_device_info: deviceInfo });
      pwdResult = codeResult;
    }
    if (!pwdResult || !pwdResult.isValid) { showAuthGateError((pwdResult && pwdResult.message) || 'كلمة مرور أو كود غير صحيح'); return; }

    currentProfile = { role: null, full_name: `شاشة قاعة: ${pwdResult.hall ? pwdResult.hall.name : ''}` };
    overlay.remove();
    injectLogoutButton();
    onSuccess();
  };
}

function showAuthGateError(msg) {
  const el = document.getElementById('authError');
  if (el) el.textContent = msg;
}

function injectLogoutButton() {
  if (document.getElementById('staffLogoutBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'staffLogoutBtn';
  btn.className = 'fixed bottom-4 left-4 z-40 px-3 py-2 bg-rose-600/90 hover:bg-rose-500 text-white text-[11px] font-bold rounded-xl shadow-lg';
  btn.textContent = `🔒 خروج (${currentProfile ? (STAFF_ROLE_LABELS[currentProfile.role] || currentProfile.full_name || '') : ''})`;
  btn.onclick = async () => { await supabaseClient.auth.signOut(); location.reload(); };
  document.body.appendChild(btn);
}
