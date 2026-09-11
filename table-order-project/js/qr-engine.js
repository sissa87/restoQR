// ============================================================================
// محرك تشفير وأمان QR الديناميكي للطاولات
// منقول بالكامل من core/qrEngine.ts الأصلي
// ============================================================================

function generateRandomSecretToken(tableNumber) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
  let rand = '';
  for (let i = 0; i < 24; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  return `SEC-TBL${tableNumber}-${rand}`;
}

/**
 * يتحقق من صحة كود QR الممسوح مقابل حالة النظام الحالية في Supabase
 * table: صف من جدول tables، activeSession: صف من جدول table_sessions أو null
 */
function verifyAndScanQR(tableNumber, scannedToken, deviceId, deviceInfo, table, activeSession, timeoutMinutes = 60) {
  if (!table) {
    return { isValid: false, status: 'INVALID_TOKEN', message: `❌ رمز QR غير صالح: الطاولة رقم #${tableNumber} غير موجودة في النظام!` };
  }
  if (table.status === 'BLOCKED_MAINTENANCE') {
    return { isValid: false, status: 'BLOCKED_TABLE', message: `❌ الطاولة رقم #${tableNumber} تحت الصيانة حالياً ولا يمكن فتح جلسة عليها.`, table };
  }
  if (table.qr_security_token !== scannedToken) {
    return { isValid: false, status: 'EXPIRED_TOKEN', message: `🔒 رمز QR قديم وغير صالح! تم تغيير الرمز السري للطاولة #${tableNumber} تلقائياً بعد مغادرة الزبون السابق.`, table };
  }

  const now = new Date();
  if (activeSession) {
    if (new Date(activeSession.expires_at) < now) {
      return { isValid: false, status: 'EXPIRED_SESSION', message: `⌛ انتهت صلاحية الجلسة المفتوحة للطاولة #${tableNumber}! يرجى إعادة مسح الرمز من الصالة.`, table, session: activeSession };
    }
    if (activeSession.device_id !== deviceId) {
      return { isValid: false, status: 'DEVICE_MISMATCH', message: `⛔ الجلسة الحالية للطاولة #${tableNumber} مقترنة بجهاز آخر! يمنع استخدام نفس الجلسة من أجهزة متعددة.`, table, session: activeSession };
    }
    return { isValid: true, status: 'SUCCESS', message: `✅ تم التحقق بنجاح! الجلسة نشطة ومقترنة بجهازك الحالي لطاولة #${tableNumber}.`, table, session: activeSession };
  }

  const expiresAt = new Date(now.getTime() + timeoutMinutes * 60000).toISOString();
  const newSession = {
    id: `sess-${tableNumber}-${Date.now()}`,
    table_number: tableNumber,
    qr_security_token: scannedToken,
    device_id: deviceId,
    device_info: deviceInfo,
    status: 'ACTIVE',
    created_at: now.toISOString(),
    expires_at: expiresAt
  };
  return { isValid: true, status: 'SESSION_CREATED', message: `🎉 أهلاً بك! تم فتح جلسة جديدة آمنة ومقترنة بجهازك لطاولة #${tableNumber}.`, table, session: newSession };
}

/**
 * توليد Secret Token جديد للطاولة (عند تحريرها أو طلب الآدمن)
 */
function createNewTableToken(table) {
  const token = generateRandomSecretToken(table.number);
  return { ...table, qr_security_token: token, token_created_at: new Date().toISOString() };
}
