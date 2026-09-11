// ============================================================================
// محرك آلة الحالات (State Machine Engine)
// منقول بالكامل من core/stateMachine.ts الأصلي - نفس منطق الانتقالات والصلاحيات
// ============================================================================

// 🆕 تبسيط دورة حياة الطلب إلى 4 أوضاع ظاهرة للمستخدم: (بانتظار الدفع/تم الدفع)
// ← (تسليم للمطبخ - يدمج الاستلام والتحضير في خطوة واحدة) ← (جاهز) ← (تم تسليم).
// SUBMITTED/PAID تنتقلان الآن مباشرة إلى IN_PREPARATION بضغطة واحدة من المراقب
// بدل المرور إجبارياً بمرحلة KITCHEN_RECEIVED المنفصلة. يبقى مسار KITCHEN_RECEIVED
// معرّفاً فقط للتوافق مع أي طلب قديم ما زال عالقاً بهذه الحالة تحديداً.
const ORDER_TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PAID', 'KITCHEN_RECEIVED', 'IN_PREPARATION', 'CANCELLED'],
  PAID: ['KITCHEN_RECEIVED', 'IN_PREPARATION', 'CANCELLED'],
  KITCHEN_RECEIVED: ['IN_PREPARATION', 'CANCELLED'],
  IN_PREPARATION: ['READY_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_DELIVERY: ['DELIVERED_TO_TABLE', 'CANCELLED'],
  DELIVERED_TO_TABLE: ['COMPLETED', 'PAYMENT_PENDING', 'CANCELLED'], // CANCELLED: يسمح فقط بالإغلاق القسري من المراقب لطلب عالق (انظر closeOrderAndFreeTable)
  PAYMENT_PENDING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

const ROLE_ORDER_PERMISSIONS = {
  CUSTOMER: ['SUBMITTED', 'CANCELLED'],
  WAITER: ['SUBMITTED', 'DELIVERED_TO_TABLE', 'CANCELLED'],
  KITCHEN: ['KITCHEN_RECEIVED', 'IN_PREPARATION', 'READY_FOR_DELIVERY'],
  CASHIER: ['PAID', 'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED'],
  MONITOR: ['KITCHEN_RECEIVED', 'IN_PREPARATION', 'READY_FOR_DELIVERY', 'DELIVERED_TO_TABLE', 'CANCELLED', 'COMPLETED'], // المراقب يقدر يُغلق قسراً طلباً عالقاً بحالة "مكتمل" (وليس ملغى) لتحرير الطاولة - إجراء استثنائي يتجاوز آلة الحالات في monitor.html مباشرة
  MANAGER: ['DRAFT','SUBMITTED','PAID','KITCHEN_RECEIVED','IN_PREPARATION','READY_FOR_DELIVERY','DELIVERED_TO_TABLE','PAYMENT_PENDING','COMPLETED','CANCELLED'],
  OWNER: ['DRAFT','SUBMITTED','PAID','KITCHEN_RECEIVED','IN_PREPARATION','READY_FOR_DELIVERY','DELIVERED_TO_TABLE','PAYMENT_PENDING','COMPLETED','CANCELLED'],
  ADMIN: ['DRAFT','SUBMITTED','PAID','KITCHEN_RECEIVED','IN_PREPARATION','READY_FOR_DELIVERY','DELIVERED_TO_TABLE','PAYMENT_PENDING','COMPLETED','CANCELLED']
};

const TABLE_TRANSITIONS = {
  AVAILABLE: ['RESERVED', 'OCCUPIED', 'BLOCKED_MAINTENANCE'],
  RESERVED: ['OCCUPIED', 'AVAILABLE', 'BLOCKED_MAINTENANCE'],
  OCCUPIED: ['PAYMENT_PENDING', 'DIRTY_CLEANING', 'AVAILABLE'], // للمراقب: تحرير الطاولة مباشرة إلى "جاهزة" بعد تنظيفها يدوياً بدون المرور بمرحلة "قيد التنظيف"
  PAYMENT_PENDING: ['DIRTY_CLEANING'],
  DIRTY_CLEANING: ['AVAILABLE', 'BLOCKED_MAINTENANCE'],
  BLOCKED_MAINTENANCE: ['AVAILABLE']
};

const QUEUE_TRANSITIONS = {
  WAITING: ['CONFIRMED_ARRIVED', 'CALLED', 'SKIPPED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED_ARRIVED: ['CALLED', 'SEATED', 'SKIPPED', 'CANCELLED', 'NO_SHOW'],
  CALLED: ['SEATED', 'SKIPPED', 'NO_SHOW', 'CANCELLED'],
  SKIPPED: ['CALLED', 'CONFIRMED_ARRIVED', 'WAITING', 'CANCELLED', 'NO_SHOW'],
  SEATED: [],
  CANCELLED: [],
  NO_SHOW: []
};

const RESERVATION_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
};

class StateMachineError extends Error {
  constructor(message) { super(message); this.name = 'StateMachineError'; }
}

function validateOrderTransition(current, next, role, policy = 'KITCHEN_FIRST') {
  if (current === 'SUBMITTED' && (next === 'KITCHEN_RECEIVED' || next === 'IN_PREPARATION') && policy === 'PAYMENT_FIRST') {
    throw new StateMachineError('سسياسة الدفع أولا : الدفع قبل ارسال الطلب للتحضير!');
  }
  if (current === 'SUBMITTED' && next === 'PAID' && policy === 'KITCHEN_FIRST') {
    throw new StateMachineError('سياسة المطبخ أولاً مفعلة: الطلب ينتقل للمطبخ مباشرة وسيتم السداد بعد تناول الطعام!');
  }
  if (current === 'DELIVERED_TO_TABLE' && next === 'COMPLETED' && policy === 'KITCHEN_FIRST') {
    throw new StateMachineError('سياسة المطبخ أولاً مفعلة: يجب نقل الطلب لحالة [PAYMENT_PENDING] وتحصيله عبر الكاشير لإغلاقه!');
  }
  const allowedNext = ORDER_TRANSITIONS[current] || [];
  if (!allowedNext.includes(next)) {
    throw new StateMachineError(`مخالفة آلة حالات الطلب: لا يمكن الانتقال من [${current}] إلى [${next}]!`);
  }
  const allowedRoles = ROLE_ORDER_PERMISSIONS[role] || [];
  if (!allowedRoles.includes(next)) {
    throw new StateMachineError(`غير مصرح لدور [${role}] بتحويل حالة الطلب إلى [${next}]`);
  }
  return true;
}

function validateTableTransition(current, next) {
  const allowedNext = TABLE_TRANSITIONS[current] || [];
  if (!allowedNext.includes(next)) {
    throw new StateMachineError(`مخالفة آلة حالات الطاولة: لا يمكن الانتقال من [${current}] إلى [${next}]!`);
  }
  return true;
}

function validateQueueTransition(current, next) {
  const allowedNext = QUEUE_TRANSITIONS[current] || [];
  if (!allowedNext.includes(next)) {
    throw new StateMachineError(`مخالفة آلة حالات طابور الانتظار: لا يمكن الانتقال من [${current}] إلى [${next}]!`);
  }
  return true;
}

function validateReservationTransition(current, next) {
  const allowedNext = RESERVATION_TRANSITIONS[current] || [];
  if (!allowedNext.includes(next)) {
    throw new StateMachineError(`مخالفة آلة حالات الحجوزات: لا يمكن الانتقال من [${current}] إلى [${next}]!`);
  }
  return true;
}
