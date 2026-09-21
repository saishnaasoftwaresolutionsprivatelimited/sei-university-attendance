/**
 * SEI University Attendance & Parent Notification System
 * Client-side Application Controller
 */

// ==================== UTILITIES & HELPERS ====================
const $ = id => document.getElementById(id);

const toast = (message, type = 'info') => {
  const t = $('toast');
  if (!t) return;
  t.textContent = message;
  t.className = `toast-notification toast-${type}`;
  t.style.display = 'block';
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => {
    t.style.display = 'none';
  }, 5000);
};

const api = async (url, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Server request failed');
  }
  return data;
};

const formatDate = d => {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const getInitials = name => {
  if (!name) return 'U';
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  return p[0].slice(0, 2).toUpperCase();
};

const sanitizePhone = s => String(s || '').replace(/\D/g, '');

// ==================== APPLICATION STATE ====================
const state = {
  currentTab: 'dashboard',
  selectedDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
  allStudents: [],
  attendanceRecords: [],
  selectedDepartment: 'ALL',
  searchQuery: '',
  studentSearchQuery: '',
  studentDeptFilter: 'ALL',
  studentYearFilter: 'ALL',
  currentReportType: 'daily',
  alertsFilterChannel: 'ALL',
  previewAlerts: [],
  activeAlertStudent: null
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initNavigation();
  initDashboardControls();
  initStudentModal();
  initNotificationsControls();
  initReportsControls();

  // Set default dates
  $('attendance-day').value = state.selectedDate;
  $('notice-day').value = state.selectedDate;
  $('report-day').value = state.selectedDate;
  $('report-month').value = state.selectedDate.slice(0, 7);

  // Initial load
  checkGmailStatus();
  $('test-gmail-btn')?.addEventListener('click', testGmailConnection);

  loadStudents().then(() => {
    loadAttendance();
    loadAlerts();
  });
});

function initClock() {
  const update = () => {
    const el = $('live-datetime');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  };
  update();
  setInterval(update, 60000);
}

// ==================== GMAIL CONNECTION STATUS ====================
async function checkGmailStatus() {
  try {
    const res = await api('/api/email/status');
    const headerBadge = $('gmail-header-badge');
    const headerText = $('gmail-header-text');
    const pulseDot = $('gmail-pulse-dot');
    const cardTitle = $('gmail-card-title');
    const cardSubtitle = $('gmail-card-subtitle');
    const cardIcon = $('gmail-status-icon');

    if (res.connected) {
      if (headerText) headerText.textContent = 'Gmail Connected';
      if (pulseDot) pulseDot.style.backgroundColor = '#10b981';
      if (cardTitle) cardTitle.textContent = 'University Gmail Server: Connected';
      if (cardSubtitle) cardSubtitle.textContent = `Account: ${res.user} • Host: smtp.gmail.com:587 (TLS Enabled)`;
      if (cardIcon) {
        cardIcon.className = 'kpi-icon emerald';
      }
    } else {
      if (headerText) headerText.textContent = res.configured ? 'Gmail Error' : 'Gmail Not Configured';
      if (pulseDot) pulseDot.style.backgroundColor = '#f59e0b';
      if (cardTitle) cardTitle.textContent = res.configured ? 'University Gmail: Connection Failed' : 'Gmail Not Configured';
      if (cardSubtitle) cardSubtitle.textContent = res.message || 'Please check SMTP credentials in .env';
      if (cardIcon) {
        cardIcon.className = 'kpi-icon amber';
      }
    }
  } catch (err) {
    console.error('Error checking Gmail status:', err);
  }
}

async function testGmailConnection() {
  const btn = $('test-gmail-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
  }
  try {
    const res = await api('/api/email/test', { method: 'POST' });
    toast(res.message, 'success');
    await checkGmailStatus();
  } catch (err) {
    toast('Gmail connection failed: ' + err.message, 'error');
    await checkGmailStatus();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Test Gmail Connection</span>`;
    }
  }
}

// ==================== NAVIGATION TABS ====================
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target);
    });
  });
}

function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });

  if (tabName === 'dashboard') {
    loadAttendance();
  } else if (tabName === 'students') {
    loadStudents();
  } else if (tabName === 'notifications') {
    loadAbsentQueue();
    loadAlerts();
  } else if (tabName === 'reports') {
    loadReportView();
  }
}

// ==================== TAB 1: DASHBOARD & ATTENDANCE ====================
function initDashboardControls() {
  $('attendance-day').addEventListener('change', e => {
    state.selectedDate = e.target.value;
    $('notice-day').value = state.selectedDate;
    $('report-day').value = state.selectedDate;
    loadAttendance();
  });

  $('today-btn').addEventListener('click', () => {
    state.selectedDate = new Date().toLocaleDateString('en-CA');
    $('attendance-day').value = state.selectedDate;
    $('notice-day').value = state.selectedDate;
    loadAttendance();
  });

  $('prev-day-btn').addEventListener('click', () => {
    const d = new Date(state.selectedDate);
    d.setDate(d.getDate() - 1);
    state.selectedDate = d.toLocaleDateString('en-CA');
    $('attendance-day').value = state.selectedDate;
    $('notice-day').value = state.selectedDate;
    loadAttendance();
  });

  $('next-day-btn').addEventListener('click', () => {
    const d = new Date(state.selectedDate);
    d.setDate(d.getDate() + 1);
    state.selectedDate = d.toLocaleDateString('en-CA');
    $('attendance-day').value = state.selectedDate;
    $('notice-day').value = state.selectedDate;
    loadAttendance();
  });

  $('dept-filter').addEventListener('change', e => {
    state.selectedDepartment = e.target.value;
    renderRosterTable();
    updateKPICards();
  });

  $('roster-search').addEventListener('input', e => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderRosterTable();
  });

  $('mark-all-present-btn').addEventListener('click', markAllPresent);
  $('review-alerts-btn').addEventListener('click', () => {
    switchTab('notifications');
  });
}

async function loadAttendance() {
  try {
    const day = state.selectedDate;
    const records = await api(`/api/attendance?day=${encodeURIComponent(day)}`);
    state.attendanceRecords = records;
    populateDepartmentDropdowns();
    renderRosterTable();
    updateKPICards();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function populateDepartmentDropdowns() {
  const depts = new Set();
  state.allStudents.forEach(s => {
    if (s.department) depts.add(s.department);
    else if (s.course) depts.add(s.course);
  });

  const deptList = Array.from(depts).sort();

  const updateSelect = (selectEl, currentValue) => {
    if (!selectEl) return;
    const current = selectEl.value || currentValue || 'ALL';
    selectEl.innerHTML = '<option value="ALL">All Departments</option>';
    deptList.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      selectEl.appendChild(opt);
    });
    selectEl.value = current;
  };

  updateSelect($('dept-filter'), state.selectedDepartment);
  updateSelect($('student-dept-filter'), state.studentDeptFilter);
  updateSelect($('report-dept'), 'ALL');
}

function updateKPICards() {
  let records = state.attendanceRecords;
  if (state.selectedDepartment !== 'ALL') {
    records = records.filter(r => (r.department === state.selectedDepartment || r.course === state.selectedDepartment));
  }

  const total = records.length;
  const present = records.filter(r => r.status === 'PRESENT').length;
  const absent = records.filter(r => r.status === 'ABSENT').length;
  const late = records.filter(r => r.status === 'LATE').length;
  const rate = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 0;

  $('stat-total').textContent = total;
  $('stat-present').textContent = present;
  $('stat-absent').textContent = absent;
  $('stat-late').textContent = late;
  $('stat-rate').textContent = `${rate}%`;
  $('stat-progress').style.width = `${rate}%`;
  $('stat-present-rate').textContent = total > 0 ? `${Math.round((present / total) * 100)}% of enrolled` : '0% of enrolled';

  // Absent notification badge
  const absentBadge = $('absent-badge');
  if (absentBadge) {
    if (absent > 0) {
      absentBadge.textContent = absent;
      absentBadge.style.display = 'inline-block';
    } else {
      absentBadge.style.display = 'none';
    }
  }

  // Update Review & Send Alerts button styling
  const reviewBtn = $('review-alerts-btn');
  if (reviewBtn) {
    if (absent > 0) {
      reviewBtn.classList.add('btn-primary');
      reviewBtn.classList.remove('btn-secondary');
    } else {
      reviewBtn.classList.remove('btn-primary');
      reviewBtn.classList.add('btn-secondary');
    }
  }
}

function renderRosterTable() {
  const tbody = $('roster-body');
  if (!tbody) return;

  let records = state.attendanceRecords;
  if (state.selectedDepartment !== 'ALL') {
    records = records.filter(r => (r.department === state.selectedDepartment || r.course === state.selectedDepartment));
  }
  if (state.searchQuery) {
    records = records.filter(r =>
      r.roll_no.toLowerCase().includes(state.searchQuery) ||
      r.full_name.toLowerCase().includes(state.searchQuery)
    );
  }

  $('roster-count-badge').textContent = `${records.length} Students`;
  $('roster-subtitle').textContent = `Date: ${formatDate(state.selectedDate)} · Department: ${state.selectedDepartment}`;

  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No matching student records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(s => {
    const status = s.status || 'NOT_MARKED';
    let badgeClass = 'badge-unmarked';
    let badgeLabel = 'Not Marked';

    if (status === 'PRESENT') {
      badgeClass = 'badge-present';
      badgeLabel = 'Present';
    } else if (status === 'ABSENT') {
      badgeClass = 'badge-absent';
      badgeLabel = 'Absent';
    } else if (status === 'LATE') {
      badgeClass = 'badge-late';
      badgeLabel = 'Late';
    }

    const initials = getInitials(s.full_name);

    return `
      <tr data-student-id="${s.id}">
        <td><strong>${s.roll_no}</strong></td>
        <td>
          <div class="student-info-cell">
            <div class="avatar-badge">${initials}</div>
            <div>
              <div style="font-weight: 600; color: var(--slate-900);">${s.full_name}</div>
              <div class="student-meta">${s.parent_name ? 'Guardian: ' + s.parent_name : ''}</div>
            </div>
          </div>
        </td>
        <td>
          <div>${s.course}</div>
          <div class="student-meta">${s.department || ''}</div>
        </td>
        <td>${s.year || '1st Year'} - ${s.section || 'A'}</td>
        <td>
          <span class="badge ${badgeClass}">${badgeLabel}</span>
        </td>
        <td>
          <div class="status-btn-group">
            <button type="button" class="status-toggle-btn ${status === 'PRESENT' ? 'active-present' : ''}" onclick="markStudentAttendance(${s.id}, 'PRESENT')">Present</button>
            <button type="button" class="status-toggle-btn ${status === 'ABSENT' ? 'active-absent' : ''}" onclick="markStudentAttendance(${s.id}, 'ABSENT')">Absent</button>
            <button type="button" class="status-toggle-btn ${status === 'LATE' ? 'active-late' : ''}" onclick="markStudentAttendance(${s.id}, 'LATE')">Late</button>
          </div>
        </td>
        <td style="text-align: right;">
          ${status === 'ABSENT' ? `
            <button type="button" class="btn btn-secondary btn-icon" style="font-size: 0.78rem;" onclick="openAlertModalForStudent(${s.id})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <span>${s.alert_count > 0 ? 'Alert Logged' : 'Send Alert'}</span>
            </button>
          ` : '<span class="student-meta">—</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

window.markStudentAttendance = async (studentId, status) => {
  try {
    const res = await api('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        day: state.selectedDate,
        status
      })
    });

    // Update in-memory state
    const target = state.attendanceRecords.find(r => r.id === studentId);
    if (target) {
      target.status = status;
    }

    renderRosterTable();
    updateKPICards();
    toast(`Attendance marked: ${status}`, 'success');

    // If marked absent, suggest sending alert or open preview
    if (status === 'ABSENT') {
      openAlertModalForStudent(studentId);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
};

async function markAllPresent() {
  let records = state.attendanceRecords;
  if (state.selectedDepartment !== 'ALL') {
    records = records.filter(r => (r.department === state.selectedDepartment || r.course === state.selectedDepartment));
  }
  if (!records.length) {
    return toast('No students to mark in current view', 'warning');
  }

  const studentIds = records.map(r => r.id);
  try {
    await api('/api/attendance/bulk', {
      method: 'POST',
      body: JSON.stringify({
        day: state.selectedDate,
        status: 'PRESENT',
        student_ids: studentIds
      })
    });

    records.forEach(r => r.status = 'PRESENT');
    renderRosterTable();
    updateKPICards();
    toast(`Marked ${records.length} students PRESENT`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== TAB 2: STUDENT MANAGEMENT ====================
function initStudentModal() {
  const modal = $('student-modal');
  $('add-student-btn').addEventListener('click', () => {
    openStudentModal();
  });

  $('close-student-modal-btn').addEventListener('click', () => modal.close());
  $('cancel-student-modal-btn').addEventListener('click', () => modal.close());

  $('student-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const id = $('form-student-id').value;

    const payload = {
      roll_no: form.elements.roll_no.value.trim(),
      full_name: form.elements.full_name.value.trim(),
      course: form.elements.course.value.trim(),
      department: form.elements.department.value.trim(),
      year: form.elements.year.value,
      section: form.elements.section.value.trim(),
      parent_name: form.elements.parent_name.value.trim(),
      parent_email: form.elements.parent_email.value.trim(),
      parent_phone: form.elements.parent_phone.value.trim(),
      parent_whatsapp: form.elements.parent_whatsapp.value.trim(),
      whatsapp_consent: form.elements.whatsapp_consent.checked,
      sms_consent: form.elements.sms_consent.checked
    };

    try {
      if (id) {
        await api(`/api/students/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        toast('Student record updated successfully', 'success');
      } else {
        await api('/api/students', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        toast('New student enrolled successfully', 'success');
      }

      modal.close();
      await loadStudents();
      await loadAttendance();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Filter handlers
  $('student-search').addEventListener('input', e => {
    state.studentSearchQuery = e.target.value.toLowerCase().trim();
    renderStudentsTable();
  });

  $('student-dept-filter').addEventListener('change', e => {
    state.studentDeptFilter = e.target.value;
    renderStudentsTable();
  });

  $('student-year-filter').addEventListener('change', e => {
    state.studentYearFilter = e.target.value;
    renderStudentsTable();
  });

  // Delete modal handlers
  $('close-delete-modal-btn').addEventListener('click', () => $('delete-modal').close());
  $('cancel-delete-btn').addEventListener('click', () => $('delete-modal').close());
  $('confirm-delete-btn').addEventListener('click', async () => {
    const id = $('delete-student-id').value;
    if (!id) return;
    try {
      await api(`/api/students/${id}`, { method: 'DELETE' });
      $('delete-modal').close();
      toast('Student deleted', 'success');
      await loadStudents();
      await loadAttendance();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadStudents() {
  try {
    const students = await api('/api/students');
    state.allStudents = students;
    populateDepartmentDropdowns();
    populateReportsStudentDropdown();
    renderStudentsTable();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderStudentsTable() {
  const tbody = $('students-body');
  if (!tbody) return;

  let list = state.allStudents;
  if (state.studentDeptFilter !== 'ALL') {
    list = list.filter(s => s.department === state.studentDeptFilter || s.course === state.studentDeptFilter);
  }
  if (state.studentYearFilter !== 'ALL') {
    list = list.filter(s => s.year === state.studentYearFilter);
  }
  if (state.studentSearchQuery) {
    list = list.filter(s =>
      s.roll_no.toLowerCase().includes(state.studentSearchQuery) ||
      s.full_name.toLowerCase().includes(state.studentSearchQuery) ||
      s.parent_name.toLowerCase().includes(state.studentSearchQuery) ||
      s.parent_email.toLowerCase().includes(state.studentSearchQuery)
    );
  }

  $('student-count-badge').textContent = `${list.length} Students`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No matching registered students found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const initials = getInitials(s.full_name);
    return `
      <tr>
        <td><strong>${s.roll_no}</strong></td>
        <td>
          <div class="student-info-cell">
            <div class="avatar-badge">${initials}</div>
            <div>
              <div style="font-weight: 600; color: var(--slate-900);">${s.full_name}</div>
            </div>
          </div>
        </td>
        <td>
          <div>${s.course}</div>
          <div class="student-meta">${s.department || ''}</div>
        </td>
        <td>${s.year || '1st Year'} - ${s.section || 'A'}</td>
        <td>
          <div style="font-weight: 500;">${s.parent_name}</div>
          <div class="student-meta">${s.parent_email}</div>
          <div class="student-meta">Ph: ${s.parent_phone} · WA: ${s.parent_whatsapp}</div>
        </td>
        <td>
          <div class="consent-badges-wrapper">
            <span class="consent-pill ${s.whatsapp_consent ? 'granted' : 'denied'}">
              ${s.whatsapp_consent ? '✔ WhatsApp Opt-in' : '✖ No WhatsApp Opt-in'}
            </span>
            <span class="consent-pill ${s.sms_consent ? 'granted' : 'denied'}">
              ${s.sms_consent ? '✔ SMS Consented' : '✖ No SMS Consent'}
            </span>
          </div>
        </td>
        <td style="text-align: right;">
          <div class="row-actions">
            <button type="button" class="icon-btn" title="Edit Student" onclick="openStudentModal(${s.id})">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button type="button" class="icon-btn delete-btn" title="Delete Student" onclick="openDeleteModal(${s.id})">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.openStudentModal = (studentId = null) => {
  const modal = $('student-modal');
  const form = $('student-form');
  form.reset();

  if (studentId) {
    const s = state.allStudents.find(x => x.id === studentId);
    if (!s) return;
    $('student-modal-title').textContent = 'Edit Student Details';
    $('form-student-id').value = s.id;
    form.elements.roll_no.value = s.roll_no;
    form.elements.full_name.value = s.full_name;
    form.elements.course.value = s.course;
    form.elements.department.value = s.department || '';
    form.elements.year.value = s.year || '1st Year';
    form.elements.section.value = s.section || 'A';
    form.elements.parent_name.value = s.parent_name;
    form.elements.parent_email.value = s.parent_email;
    form.elements.parent_phone.value = s.parent_phone;
    form.elements.parent_whatsapp.value = s.parent_whatsapp;
    form.elements.whatsapp_consent.checked = !!s.whatsapp_consent;
    form.elements.sms_consent.checked = !!s.sms_consent;
  } else {
    $('student-modal-title').textContent = 'Add New Student';
    $('form-student-id').value = '';
    form.elements.year.value = '1st Year';
    form.elements.section.value = 'A';
  }

  modal.showModal();
};

window.openDeleteModal = studentId => {
  const s = state.allStudents.find(x => x.id === studentId);
  if (!s) return;
  $('delete-student-id').value = s.id;
  $('delete-student-name').textContent = s.full_name;
  $('delete-student-roll').textContent = s.roll_no;
  $('delete-modal').showModal();
};

// ==================== TAB 3: PARENT NOTIFICATION CENTER ====================
function initNotificationsControls() {
  $('notice-day').addEventListener('change', () => {
    loadAbsentQueue();
  });

  $('notice-refresh-btn').addEventListener('click', async () => {
    const btn = $('notice-refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    try {
      await loadAbsentQueue();
      await loadAlerts();
      toast('Absent queue and notification logs refreshed', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Refresh';
    }
  });

  $('refresh-alerts-btn')?.addEventListener('click', async () => {
    const btn = $('refresh-alerts-btn');
    btn.disabled = true;
    try {
      await loadAlerts();
      toast('Notification logs refreshed', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('clear-all-alerts-btn')?.addEventListener('click', clearAllAlerts);

  // Filter channel pills in alert log
  document.querySelectorAll('.pill-filter').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill-filter').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.alertsFilterChannel = pill.dataset.channel;
      loadAlerts();
    });
  });

  // Modal alert dialog handlers
  const modal = $('alert-modal');
  $('close-alert-modal-btn').addEventListener('click', () => modal.close());
  $('cancel-alert-modal-btn').addEventListener('click', () => modal.close());

  $('confirm-send-alert-btn').addEventListener('click', executeSendAlert);
}

async function loadAbsentQueue() {
  const container = $('absent-queue-container');
  if (!container) return;

  const day = $('notice-day').value || state.selectedDate;

  try {
    const previewList = await api(`/api/preview?day=${encodeURIComponent(day)}`);
    state.previewAlerts = previewList;

    if (!previewList.length) {
      container.innerHTML = `<div class="empty-state">No absent students recorded for ${formatDate(day)}.</div>`;
      return;
    }

    container.innerHTML = previewList.map(item => {
      const s = item.student;
      const cleanWA = sanitizePhone(s.parent_whatsapp);
      const cleanSMS = sanitizePhone(s.parent_phone);
      const waLink = `https://wa.me/${cleanWA}?text=${encodeURIComponent(item.message)}`;
      const smsLink = `sms:${cleanSMS}?body=${encodeURIComponent(item.message)}`;

      return `
        <div class="absent-card" data-student-id="${s.id}">
          <div class="absent-card-info">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong>${s.full_name}</strong>
              <span class="badge badge-absent">Absent</span>
              <span class="student-meta">${s.roll_no} &bull; ${s.course}</span>
            </div>
            <div class="student-meta">
              Parent: <strong>${s.parent_name}</strong> &bull; Email: ${s.parent_email} &bull; Mobile: ${s.parent_phone}
            </div>
            <div class="consent-badges-wrapper" style="flex-direction: row; margin-top: 4px;">
              <span class="consent-pill ${s.whatsapp_consent ? 'granted' : 'denied'}">
                ${s.whatsapp_consent ? '✔ WhatsApp Opt-in' : '✖ No WhatsApp Opt-in'}
              </span>
              <span class="consent-pill ${s.sms_consent ? 'granted' : 'denied'}">
                ${s.sms_consent ? '✔ SMS Consented' : '✖ No SMS Consent'}
              </span>
            </div>
          </div>

          <div class="absent-card-actions">
            <!-- Review & Custom Dispatch Modal Button -->
            <button type="button" class="btn btn-primary" onclick="openAlertModalForStudent(${s.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <span>Review &amp; Dispatch</span>
            </button>

            <!-- Quick Direct Manual WhatsApp Link -->
            <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn btn-wa-link" title="Open WhatsApp Chat in Web/App">
              <span>WhatsApp Chat</span>
            </a>

            <!-- Quick Direct Manual SMS Link -->
            <a href="${smsLink}" class="btn btn-sms-link" title="Open Native SMS App">
              <span>SMS App</span>
            </a>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state text-danger">Error loading absent queue: ${err.message}</div>`;
  }
}

window.openAlertModalForStudent = async studentId => {
  const day = $('notice-day').value || state.selectedDate;
  try {
    const list = await api(`/api/preview?day=${encodeURIComponent(day)}`);
    const preview = list.find(x => x.student.id === studentId);
    if (!preview) {
      return toast('Student is not marked absent for this date', 'warning');
    }

    const s = preview.student;
    state.activeAlertStudent = preview;

    $('alert-student-id').value = s.id;
    $('alert-modal-student-info').textContent = `${s.full_name} (${s.roll_no}) · Parent: ${s.parent_name}`;
    $('alert-subject').value = preview.subject;
    $('alert-message').value = preview.message;

    $('channel-email').checked = true;
    $('channel-email-target').textContent = `Target: ${s.parent_email}`;

    // Always enable WhatsApp & SMS manual options - never disable them
    $('channel-whatsapp').checked = true;
    $('channel-whatsapp').disabled = false;
    $('channel-wa-target').textContent = `Target: ${s.parent_whatsapp || 'No number'}`;

    $('channel-sms').checked = true;
    $('channel-sms').disabled = false;
    $('channel-sms-target').textContent = `Target: ${s.parent_phone || 'No number'}`;

    // Configure direct launch links in modal
    const cleanWA = sanitizePhone(s.parent_whatsapp);
    const cleanSMS = sanitizePhone(s.parent_phone);
    const waLink = `https://wa.me/${cleanWA}?text=${encodeURIComponent(preview.message)}`;
    const smsLink = `sms:${cleanSMS}?body=${encodeURIComponent(preview.message)}`;

    const waBtn = $('modal-direct-wa-btn');
    if (waBtn) {
      waBtn.href = waLink;
      waBtn.onclick = e => e.stopPropagation();
    }

    const smsBtn = $('modal-direct-sms-btn');
    if (smsBtn) {
      smsBtn.href = smsLink;
      smsBtn.onclick = e => e.stopPropagation();
    }

    $('alert-message').oninput = () => {
      const msg = $('alert-message').value;
      if (waBtn) waBtn.href = `https://wa.me/${cleanWA}?text=${encodeURIComponent(msg)}`;
      if (smsBtn) smsBtn.href = `sms:${cleanSMS}?body=${encodeURIComponent(msg)}`;
    };

    const consentNotice = $('alert-consent-notice');
    if (!s.whatsapp_consent || !s.sms_consent) {
      consentNotice.style.display = 'block';
      consentNotice.className = 'consent-alert';
      consentNotice.innerHTML = `<div>&bull; Note: Manual dispatch links are active. Sending will record authorization for future notifications.</div>`;
    } else {
      consentNotice.style.display = 'none';
    }

    $('alert-modal').showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
};

async function executeSendAlert() {
  if (!state.activeAlertStudent) return;
  const s = state.activeAlertStudent.student;
  const day = $('notice-day').value || state.selectedDate;

  const channels = [];
  if ($('channel-email').checked) channels.push('EMAIL');
  if ($('channel-whatsapp').checked) channels.push('WHATSAPP');
  if ($('channel-sms').checked) channels.push('SMS');

  if (!channels.length) {
    return toast('Select at least one notification channel', 'warning');
  }

  const subject = $('alert-subject').value.trim();
  const message = $('alert-message').value.trim();

  if (!subject || !message) {
    return toast('Subject and Message are required', 'warning');
  }

  const confirmBtn = $('confirm-send-alert-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Processing...';

  try {
    const res = await api('/api/confirm', {
      method: 'POST',
      body: JSON.stringify({
        student_id: s.id,
        day,
        subject,
        message,
        channels,
        update_consent: true
      })
    });

    $('alert-modal').close();

    const summary = res.outcomes.map(o => `${o.channel}: ${o.status}`).join(', ');
    toast(`Alerts processed: ${summary}`, 'success');

    // Reload history
    await loadAlerts();
    await loadAbsentQueue();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm & Send';
  }
}

async function loadAlerts() {
  const tbody = $('alerts-table')?.querySelector('tbody');
  if (!tbody) return;

  let url = '/api/alerts?';
  if (state.alertsFilterChannel !== 'ALL') {
    url += `channel=${encodeURIComponent(state.alertsFilterChannel)}&`;
  }

  try {
    const alerts = await api(url);
    if (!alerts.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No notification logs recorded for this view.</td></tr>`;
      return;
    }

    tbody.innerHTML = alerts.map(a => {
      let badgeClass = 'badge-info';
      let statusLabel = a.status;

      if (a.status === 'SENT') {
        badgeClass = 'badge-success';
        statusLabel = 'Gmail Sent';
      } else if (a.status === 'READY_MANUAL') {
        badgeClass = 'badge-warning';
        statusLabel = 'Manual Ready';
      } else if (a.status === 'MANUALLY_SENT') {
        badgeClass = 'badge-blue';
        statusLabel = 'Sent by Staff';
      } else if (a.status === 'NOT_CONFIGURED') {
        badgeClass = 'badge-info';
        statusLabel = 'Not Configured';
      } else if (a.status === 'ERROR') {
        badgeClass = 'badge-danger';
        statusLabel = 'Error';
      }

      const cleanNum = sanitizePhone(a.recipient);
      const isManual = a.channel === 'WHATSAPP' || a.channel === 'SMS';
      const waUrl = `https://wa.me/${cleanNum}?text=${encodeURIComponent(a.message)}`;
      const smsUrl = `sms:${cleanNum}?body=${encodeURIComponent(a.message)}`;

      return `
        <tr>
          <td>${a.day}</td>
          <td>
            <strong>${a.full_name}</strong>
            <div class="student-meta">${a.roll_no}</div>
          </td>
          <td>
            <div>${a.parent_name || 'Guardian'}</div>
            <div class="student-meta">${a.recipient}</div>
          </td>
          <td>
            <span class="badge ${a.channel === 'EMAIL' ? 'badge-blue' : (a.channel === 'WHATSAPP' ? 'badge-success' : 'badge-warning')}">
              ${a.channel}
            </span>
          </td>
          <td>
            <span class="badge ${badgeClass}">${statusLabel}</span>
            ${a.error ? `<div class="student-meta text-danger" title="${a.error}">${a.error.slice(0, 45)}...</div>` : ''}
          </td>
          <td>
            <div style="max-width: 320px; font-size: 0.78rem; color: var(--slate-600); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${a.message}">
              ${a.message}
            </div>
          </td>
          <td style="text-align: right;">
            <div class="row-actions" style="justify-content: flex-end; gap: 6px;">
              ${a.status === 'READY_MANUAL' ? `
                <a href="${a.channel === 'WHATSAPP' ? waUrl : smsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" title="Open messaging app">
                  Open App
                </a>
                <button type="button" class="btn btn-primary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="markAlertManuallySent(${a.id})" title="Confirm manual dispatch">
                  Confirm Sent
                </button>
              ` : ''}
              <button type="button" class="icon-btn delete-btn" title="Delete notification record" onclick="deleteAlertLog(${a.id})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">${err.message}</td></tr>`;
  }
}

window.deleteAlertLog = async alertId => {
  if (!confirm('Are you sure you want to delete this notification log entry?')) {
    return;
  }
  try {
    await api(`/api/alerts/${alertId}`, { method: 'DELETE' });
    toast('Notification log entry deleted', 'success');
    await loadAlerts();
    await loadAbsentQueue();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.clearAllAlerts = async () => {
  const channel = state.alertsFilterChannel || 'ALL';
  const label = channel === 'ALL' ? 'all channels' : channel;
  if (!confirm(`Are you sure you want to clear all notification logs for ${label}?`)) {
    return;
  }
  try {
    const res = await api(`/api/alerts?channel=${encodeURIComponent(channel)}`, { method: 'DELETE' });
    toast(`Cleared ${res.deleted} notification log(s)`, 'success');
    await loadAlerts();
    await loadAbsentQueue();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.markAlertManuallySent = async alertId => {
  if (!confirm('Please confirm: Have you actually dispatched this message in the messaging application?')) {
    return;
  }
  try {
    await api(`/api/alerts/${alertId}/manual-sent`, { method: 'POST' });
    toast('Alert status updated to Manually Sent', 'success');
    loadAlerts();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ==================== TAB 4: ATTENDANCE REPORTS ====================
function initReportsControls() {
  document.querySelectorAll('.report-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentReportType = tab.dataset.report;
      updateReportFiltersVisibility();
      loadReportView();
    });
  });

  $('generate-report-btn').addEventListener('click', loadReportView);
  $('export-csv-btn').addEventListener('click', exportCSV);
}

function updateReportFiltersVisibility() {
  const type = state.currentReportType;
  const dailyCtrl = document.querySelector('.report-daily-control');
  const monthlyCtrl = document.querySelector('.report-monthly-control');
  const studentCtrl = document.querySelector('.report-student-control');
  const deptCtrl = document.querySelector('.report-dept-control');

  if (dailyCtrl) dailyCtrl.style.display = type === 'daily' ? 'flex' : 'none';
  if (monthlyCtrl) monthlyCtrl.style.display = type === 'monthly' ? 'flex' : 'none';
  if (studentCtrl) studentCtrl.style.display = type === 'student' ? 'flex' : 'none';
  if (deptCtrl) deptCtrl.style.display = type === 'student' ? 'none' : 'flex';
}

function populateReportsStudentDropdown() {
  const sel = $('report-student-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choose a student --</option>';
  state.allStudents.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.roll_no} - ${s.full_name} (${s.course})`;
    sel.appendChild(opt);
  });
}

async function loadReportView() {
  const container = $('report-view-container');
  if (!container) return;

  const type = state.currentReportType;
  const dept = $('report-dept').value || 'ALL';

  if (type === 'daily') {
    const day = $('report-day').value || state.selectedDate;
    try {
      const data = await api(`/api/reports/daily?day=${encodeURIComponent(day)}&department=${encodeURIComponent(dept)}`);
      renderDailyReport(data, container);
    } catch (err) {
      container.innerHTML = `<div class="content-card empty-state text-danger">${err.message}</div>`;
    }
  } else if (type === 'monthly') {
    const month = $('report-month').value || state.selectedDate.slice(0, 7);
    try {
      const data = await api(`/api/reports/monthly?month=${encodeURIComponent(month)}&department=${encodeURIComponent(dept)}`);
      renderMonthlyReport(data, container);
    } catch (err) {
      container.innerHTML = `<div class="content-card empty-state text-danger">${err.message}</div>`;
    }
  } else if (type === 'student') {
    const studentId = $('report-student-select').value;
    if (!studentId) {
      container.innerHTML = `<div class="content-card empty-state">Please select a student from the dropdown above to view their attendance history.</div>`;
      return;
    }
    try {
      const data = await api(`/api/reports/student?student_id=${studentId}`);
      renderStudentReport(data, container);
    } catch (err) {
      container.innerHTML = `<div class="content-card empty-state text-danger">${err.message}</div>`;
    }
  }
}

function renderDailyReport(data, container) {
  const s = data.summary;
  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Total Enrolled</span>
        <div class="kpi-value">${s.total}</div>
        <div class="kpi-footer">Daily report for ${formatDate(data.day)}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Present</span>
        <div class="kpi-value emerald-text">${s.present}</div>
        <div class="kpi-footer">${s.total > 0 ? Math.round((s.present / s.total) * 100) : 0}% of class</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Absent</span>
        <div class="kpi-value rose-text">${s.absent}</div>
        <div class="kpi-footer">Alerts logged</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Late</span>
        <div class="kpi-value amber-text">${s.late}</div>
        <div class="kpi-footer">Partial credit</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Daily Attendance Rate</span>
        <div class="kpi-value">${s.rate}%</div>
        <div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${s.rate}%"></div></div>
      </div>
    </div>

    <div class="content-card table-card" style="margin-top: 16px;">
      <div class="card-header-row">
        <h3 class="card-title">Daily Student Attendance Register (${formatDate(data.day)})</h3>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Roll Number</th>
              <th>Student Name</th>
              <th>Course &amp; Department</th>
              <th>Year &amp; Sec</th>
              <th>Attendance Status</th>
            </tr>
          </thead>
          <tbody>
            ${data.students.map(st => `
              <tr>
                <td><strong>${st.roll_no}</strong></td>
                <td>${st.full_name}</td>
                <td>${st.course} ${st.department ? ' - ' + st.department : ''}</td>
                <td>${st.year} - ${st.section}</td>
                <td>
                  <span class="badge ${st.status === 'PRESENT' ? 'badge-present' : (st.status === 'ABSENT' ? 'badge-absent' : (st.status === 'LATE' ? 'badge-late' : 'badge-unmarked'))}">
                    ${st.status}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMonthlyReport(data, container) {
  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Month</span>
        <div class="kpi-value" style="font-size: 1.5rem;">${data.month}</div>
        <div class="kpi-footer">Monthly aggregated performance</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Recorded Working Days</span>
        <div class="kpi-value">${data.workingDaysCount}</div>
        <div class="kpi-footer">Total instructional days</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Overall Average Attendance</span>
        <div class="kpi-value">${data.averageRate}%</div>
        <div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${data.averageRate}%"></div></div>
      </div>
    </div>

    <div class="content-card table-card" style="margin-top: 16px;">
      <div class="card-header-row">
        <h3 class="card-title">Student Monthly Summary (${data.month})</h3>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Roll No</th>
              <th>Student Name</th>
              <th>Department / Course</th>
              <th>Working Days</th>
              <th>Present Days</th>
              <th>Absent Days</th>
              <th>Late Days</th>
              <th>Attendance %</th>
            </tr>
          </thead>
          <tbody>
            ${data.students.map(st => {
              let rateClass = 'rate-high';
              if (st.attendance_percentage < 60) rateClass = 'rate-low';
              else if (st.attendance_percentage < 75) rateClass = 'rate-mid';

              return `
                <tr>
                  <td><strong>${st.roll_no}</strong></td>
                  <td>${st.full_name}</td>
                  <td>${st.department || st.course}</td>
                  <td>${st.total_working_days}</td>
                  <td><span class="emerald-text font-weight-600">${st.present_count}</span></td>
                  <td><span class="rose-text font-weight-600">${st.absent_count}</span></td>
                  <td><span class="amber-text font-weight-600">${st.late_count}</span></td>
                  <td>
                    <span class="rate-pill ${rateClass}">${st.attendance_percentage}%</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStudentReport(data, container) {
  const st = data.student;
  const stats = data.stats;

  let rateClass = 'rate-high';
  if (stats.rate < 60) rateClass = 'rate-low';
  else if (stats.rate < 75) rateClass = 'rate-mid';

  container.innerHTML = `
    <div class="content-card" style="margin-bottom: 16px;">
      <div class="card-header-row">
        <div>
          <h3 class="card-title">${st.full_name} (${st.roll_no})</h3>
          <p class="card-subtitle">${st.course} &bull; ${st.department} &bull; ${st.year} &bull; Section ${st.section}</p>
        </div>
        <div>
          <span class="rate-pill ${rateClass}" style="font-size: 1.1rem; padding: 6px 14px;">Overall: ${stats.rate}%</span>
        </div>
      </div>
      <div style="margin-top: 12px; font-size: 0.85rem; color: var(--slate-600);">
        Parent / Guardian: <strong>${st.parent_name}</strong> &bull; Email: ${st.parent_email} &bull; Mobile: ${st.parent_phone}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Classes Held</span>
        <div class="kpi-value">${stats.total}</div>
        <div class="kpi-footer">Total recorded days</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Present</span>
        <div class="kpi-value emerald-text">${stats.present}</div>
        <div class="kpi-footer">Days on time</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Absent</span>
        <div class="kpi-value rose-text">${stats.absent}</div>
        <div class="kpi-footer">Days missed</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Late</span>
        <div class="kpi-value amber-text">${stats.late}</div>
        <div class="kpi-footer">Late arrivals</div>
      </div>
    </div>

    <div class="content-card table-card" style="margin-top: 16px;">
      <div class="card-header-row">
        <h3 class="card-title">Chronological Attendance History</h3>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${data.history.map(h => `
              <tr>
                <td>${formatDate(h.day)}</td>
                <td>
                  <span class="badge ${h.status === 'PRESENT' ? 'badge-present' : (h.status === 'ABSENT' ? 'badge-absent' : 'badge-late')}">
                    ${h.status}
                  </span>
                </td>
                <td class="student-meta">${h.status === 'ABSENT' ? 'Absence notice triggered' : 'Attended'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function exportCSV() {
  const type = state.currentReportType;
  const dept = $('report-dept').value || 'ALL';
  let url = `/api/reports/export?type=${encodeURIComponent(type)}&department=${encodeURIComponent(dept)}`;

  if (type === 'daily') {
    url += `&day=${encodeURIComponent($('report-day').value || state.selectedDate)}`;
  } else if (type === 'monthly') {
    url += `&month=${encodeURIComponent($('report-month').value || state.selectedDate.slice(0, 7))}`;
  } else if (type === 'student') {
    const studentId = $('report-student-select').value;
    if (!studentId) return toast('Select a student first', 'warning');
    url += `&student_id=${studentId}`;
  }

  // Trigger download
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast('CSV export initiated', 'success');
}

// ==========================================================================
//  MOBILE NAVIGATION — Hamburger Menu Toggle
// ==========================================================================
(function initMobileNav() {
  const hamburgerBtn   = document.getElementById('nav-hamburger');
  const mobileNav      = document.getElementById('main-navigation');
  const closeMobileBtn = document.getElementById('close-mobile-nav');

  if (!hamburgerBtn || !mobileNav) return;

  function openNav() {
    mobileNav.classList.add('mobile-open');
    document.body.classList.add('nav-open');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    mobileNav.setAttribute('aria-hidden', 'false');
    // Focus close button for keyboard accessibility
    closeMobileBtn?.focus();
  }

  function closeNav() {
    mobileNav.classList.remove('mobile-open');
    document.body.classList.remove('nav-open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    mobileNav.setAttribute('aria-hidden', 'true');
    // Return focus to hamburger button
    hamburgerBtn?.focus();
  }

  hamburgerBtn.addEventListener('click', openNav);
  closeMobileBtn?.addEventListener('click', closeNav);

  // Tap outside the nav drawer content (on the backdrop area) closes nav
  mobileNav.addEventListener('click', function(e) {
    // Only close if clicking the nav overlay itself, not any button inside
    if (e.target === mobileNav) closeNav();
  });

  // Close nav when any tab is selected
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Small delay so the tab switching animation looks clean
      setTimeout(closeNav, 120);
    });
  });

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileNav.classList.contains('mobile-open')) {
      closeNav();
    }
  });
})();
