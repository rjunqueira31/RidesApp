const page = document.body.dataset.page;
const protectedPages = new Set([
  'dashboard', 'create-ride', 'search-rides', 'my-rides', 'profile', 'debug'
]);

const state = {
  currentUser: null,
  profiles: [],
  rides: [],
  filters: {
    driver: '',
    start: '',
    end: '',
    openOnly: false,
  },
};

const OFFICE_LOCATION_LABELS = {
  LISBON: 'Lisbon',
  PORTO: 'Porto',
  BRAGA: 'Braga',
};

function userIsManager() {
  return state.currentUser?.role === 'MANAGER_USER';
}

function escapeHtml(value) {
  return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload;
}

function setFeedback(message, isError = false) {
  const feedback = document.querySelector('#page-feedback');
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.style.color = isError ? '#b42318' : '#09005d';
}

async function loadCurrentUser() {
  try {
    const payload = await api('/api/auth/me');
    state.currentUser = payload.profile;
    return payload.profile;
  } catch {
    state.currentUser = null;
    return null;
  }
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Intl
      .DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
      .format(new Date(value));
}

function formatDateForInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
}

function formatTimeForInput(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${
      String(date.getMinutes()).padStart(2, '0')}`;
}

function combineDateAndTime(dateValue, timeValue) {
  return `${dateValue}T${timeValue}`;
}

function roundUpToQuarterHour(date) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 15;

  if (remainder !== 0) {
    rounded.setMinutes(minutes + (15 - remainder));
  }

  return rounded;
}

function addMinutesToTime(timeValue, minutesToAdd) {
  const [hours, minutes] =
      String(timeValue || '').split(':').map((value) => Number(value));

  if ([hours, minutes].some((value) => Number.isNaN(value))) {
    return '';
  }

  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const normalizedMinutes =
      ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nextHours = String(Math.floor(normalizedMinutes / 60)).padStart(2, '0');
  const nextMinutes = String(normalizedMinutes % 60).padStart(2, '0');

  return `${nextHours}:${nextMinutes}`;
}

function validateRideDateTime(dateValue, startTime, endTime) {
  const start = new Date(combineDateAndTime(dateValue, startTime));
  const end = new Date(combineDateAndTime(dateValue, endTime));
  const now = new Date();

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Please choose a valid departure window.');
  }

  if (start.getTime() < now.getTime()) {
    throw new Error('Earliest departure must be in the future.');
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error('Latest departure must be later than earliest departure.');
  }

  return {
    startWindowStart: start.toISOString(),
    startWindowEnd: end.toISOString(),
  };
}

function syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput) {
  const now = new Date();
  const today = formatDateForInput(now);
  const isToday = dateInput.value === today;

  if (isToday) {
    const minStartTime = formatTimeForInput(roundUpToQuarterHour(now));
    startTimeInput.min = minStartTime;

    if (!startTimeInput.value || startTimeInput.value < minStartTime) {
      startTimeInput.value = minStartTime;
    }
  } else {
    startTimeInput.min = '';
  }

  const minEndTime = addMinutesToTime(startTimeInput.value, 15);
  endTimeInput.min = minEndTime;

  if (!endTimeInput.value || endTimeInput.value <= startTimeInput.value) {
    endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
  }

  if (endTimeInput.value < minEndTime) {
    endTimeInput.value = minEndTime;
  }
}

function redirectTo(path) {
  window.location.href = path;
}

function ensureNotesModal() {
  let modal = document.querySelector('#notes-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="notes-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-notes-modal="true"></div>
      <div class="notes-modal-panel" role="dialog" aria-modal="true" aria-labelledby="notes-modal-title">
        <div class="notes-modal-header">
          <h2 id="notes-modal-title">Ride notes</h2>
          <button type="button" class="button-secondary notes-modal-close" data-close-notes-modal="true" aria-label="Close notes">Close</button>
        </div>
        <div id="notes-modal-content" class="notes-modal-content"></div>
      </div>
    </div>
  `);

  modal = document.querySelector('#notes-modal');
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-notes-modal="true"]')) {
      modal.hidden = true;
    }
  });

  return modal;
}

function openNotesModal(notesText) {
  const modal = ensureNotesModal();
  const content = modal.querySelector('#notes-modal-content');
  content.textContent = notesText;
  modal.hidden = false;
}

function ensureRideCreatedModal() {
  let modal = document.querySelector('#ride-created-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-created-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-ride-created-modal="true"></div>
      <div class="notes-modal-panel ride-created-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-created-modal-title">
        <div class="notes-modal-header">
          <h2 id="ride-created-modal-title">Ride published</h2>
          <button type="button" class="button-secondary notes-modal-close" data-close-ride-created-modal="true" aria-label="Close confirmation">Close</button>
        </div>
        <p class="ride-created-copy">Your ride is now visible to colleagues.</p>
        <div id="ride-created-summary" class="ride-created-summary"></div>
        <div class="ride-created-actions">
          <button type="button" class="button-secondary" data-close-ride-created-modal="true">Create another</button>
          <button type="button" id="ride-created-view-my-rides">See my rides</button>
        </div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-created-modal');
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-ride-created-modal="true"]')) {
      modal.hidden = true;
    }

    if (event.target.closest('#ride-created-view-my-rides')) {
      redirectTo('my-rides.html');
    }
  });

  return modal;
}

function openRideCreatedModal(ride) {
  const modal = ensureRideCreatedModal();
  const summary = modal.querySelector('#ride-created-summary');

  summary.innerHTML = `
    <div class="ride-created-route">${escapeHtml(ride.startPoint)} to ${
      escapeHtml(ride.endPoint)}</div>
    <div class="ride-created-meta">${
      escapeHtml(formatDateTime(ride.startWindowStart))} to ${
      escapeHtml(formatDateTime(ride.startWindowEnd))}</div>
    <div class="ride-created-meta">${escapeHtml(ride.car)} · ${
      escapeHtml(ride.seatsTotal)} seat${
      Number(ride.seatsTotal) === 1 ? '' : 's'}</div>
  `;

  modal.hidden = false;
}

function formatOfficeLocation(value) {
  return OFFICE_LOCATION_LABELS[value] || '';
}

function syncSelectPlaceholderState(select) {
  if (!select) {
    return;
  }

  select.classList.toggle('select-placeholder', !select.value);
}

function applyUserRouteDefaults(form) {
  const startPointInput = form.querySelector('input[name="startPoint"]');
  const endPointInput = form.querySelector('input[name="endPoint"]');

  if (startPointInput && !startPointInput.value) {
    startPointInput.value = state.currentUser.defaultHome || '';
  }

  if (endPointInput && !endPointInput.value) {
    endPointInput.value = formatOfficeLocation(state.currentUser.defaultOffice);
  }
}

function swapInputValues(firstInput, secondInput) {
  const firstValue = firstInput.value;
  firstInput.value = secondInput.value;
  secondInput.value = firstValue;
}

function hydrateUserPill() {
  const pill = document.querySelector('#current-user-pill');
  if (!pill || !state.currentUser) {
    return;
  }

  pill.textContent = `${state.currentUser.name} · ${state.currentUser.email}`;
}

function wireLogout() {
  const logoutButton = document.querySelector('#logout-button');
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Ignore logout failures locally and clear client state anyway.
    } finally {
      state.currentUser = null;
      redirectTo('index.html');
    }
  });
}

async function loadProfiles() {
  const payload = await api('/api/profiles');
  state.profiles = payload.profiles;
  return payload.profiles;
}

async function loadRides(filters = {}) {
  const params = new URLSearchParams();

  if (filters.driver) {
    params.set('driver', filters.driver);
  }
  if (filters.start) {
    params.set('start', filters.start);
  }
  if (filters.end) {
    params.set('end', filters.end);
  }
  if (filters.openOnly) {
    params.set('openOnly', 'true');
  }

  const payload = await api(
      `/api/rides${params.toString() ? `?${params.toString()}` : ''}`);
  state.rides = payload.rides;
  return payload.rides;
}

function getCurrentUserRequest(ride) {
  if (!state.currentUser) {
    return null;
  }

  return ride.requests.find(
      (request) => request.passengerId === state.currentUser.id);
}

function userCanChat(ride) {
  if (!state.currentUser) {
    return false;
  }

  if (ride.driverId === state.currentUser.id) {
    return true;
  }

  const request = getCurrentUserRequest(ride);
  return Boolean(request && ['pending', 'accepted'].includes(request.status));
}

function renderDriverRequests(ride) {
  if (!ride.requests.length) {
    return '<div class="empty-state">No passenger requests yet.</div>';
  }

  return `
    <section>
      <h3>Passenger requests</h3>
      <ul class="request-list">
        ${
      ride.requests
          .map(
              (request) => `
              <li>
                <div class="request-item">
                  <strong>${
                  escapeHtml(
                      request.passenger?.name ||
                      request.passengerEmail)}</strong>
                  <span class="meta">${escapeHtml(request.passengerEmail)} · ${
                  escapeHtml(request.message || 'No message')}</span>
                  <span class="pill status-${request.status}">${
                  escapeHtml(request.status)}</span>
                  ${
                  request.status === 'pending' ?
                      `
                      <div class="actions">
                        <button type="button" class="manage-request" data-request-id="${
                          request.id}" data-decision="accepted">Accept</button>
                        <button type="button" class="manage-request button-secondary" data-request-id="${
                          request.id}" data-decision="declined">Decline</button>
                      </div>
                    ` :
                      ''}
                </div>
              </li>
            `)
          .join('')}
      </ul>
    </section>
  `;
}

function renderChat(ride) {
  return `
    <section class="chat-box">
      <h3>Ride chat</h3>
      <ul class="chat-messages">
        ${
      ride.messages.length ?
          ride.messages
              .map(
                  (message) => `
                  <li class="chat-message">
                    <div class="chat-meta">
                      <strong>${
                      escapeHtml(
                          message.sender?.name || message.senderEmail)}</strong>
                      <span>${formatDateTime(message.createdAt)}</span>
                    </div>
                    <div>${escapeHtml(message.text)}</div>
                  </li>
                `)
              .join('') :
          '<li class="empty-state">No messages yet. Use chat to coordinate pickup details.</li>'}
      </ul>
      <form class="chat-form" data-chat-ride-id="${ride.id}">
        <label>
          New message
          <textarea name="text" rows="2" placeholder="Share pickup details or arrival timing."></textarea>
        </label>
        <button type="submit">Send message</button>
      </form>
    </section>
  `;
}

function renderRideCard(ride, options = {}) {
  const {allowRequest = true} = options;
  const isDriver = state.currentUser && ride.driverId === state.currentUser.id;
  const currentRequest = getCurrentUserRequest(ride);
  const canRequest = allowRequest && state.currentUser && !isDriver &&
      !currentRequest && ride.seatsLeft > 0;
  const chatEnabled = userCanChat(ride);
  const notes = String(ride.notes || '').trim();
  const hasNotes = Boolean(notes);
  const notesPreview = hasNotes ?
      `${escapeHtml(notes.slice(0, 72))}${notes.length > 72 ? '...' : ''}` :
      'No extra notes';

  return `
    <article class="ride-card" data-ride-id="${ride.id}">
      <div>
        <div class="route">${escapeHtml(ride.startPoint)} → ${
      escapeHtml(ride.endPoint)}</div>
        <div class="meta">Driver: ${
      escapeHtml(ride.driver?.name || ride.driverEmail)}</div>
      </div>

      <div class="card-grid">
        <div>
          <strong>Window</strong>
          <div class="meta">${formatDateTime(ride.startWindowStart)} - ${
      formatDateTime(ride.startWindowEnd)}</div>
        </div>
        <div>
          <strong>Car</strong>
          <div class="meta">${escapeHtml(ride.car)}</div>
        </div>
        <div>
          <strong>Seats left</strong>
          <div class="meta">${ride.seatsLeft} / ${ride.seatsTotal}</div>
        </div>
        <div>
          <strong>Notes</strong>
          <div class="meta ride-notes-preview">${notesPreview}</div>
          ${
      hasNotes ?
          `<button type="button" class="button-secondary toggle-notes" data-notes="${
              encodeURIComponent(notes)}">See all notes</button>` :
          ''}
        </div>
      </div>

      <div class="pill-row">
        <span class="pill">${ride.requests.length} requests</span>
        ${
      currentRequest ?
          `<span class="pill status-${currentRequest.status}">Your request: ${
              escapeHtml(currentRequest.status)}</span>` :
          ''}
        ${
      ride.seatsLeft === 0 ? '<span class="pill status-declined">Full</span>' :
                             '<span class="pill status-accepted">Open</span>'}
      </div>

      <div class="actions">
        <button type="button" class="refresh-rides button-secondary">Refresh</button>
      </div>

      ${
      canRequest ? `
        <form class="request-form" data-request-ride-id="${ride.id}">
          <label>
            Optional message to the driver
            <textarea name="message" rows="2" placeholder="Can I join this ride?"></textarea>
          </label>
          <button type="submit">Request seat</button>
        </form>
      ` :
                   ''}

      ${isDriver ? renderDriverRequests(ride) : ''}
      ${chatEnabled ? renderChat(ride) : ''}
    </article>
  `;
}

async function handleRideActions(container, refresh) {
  container.addEventListener('click', async (event) => {
    const rideCard = event.target.closest('[data-ride-id]');
    if (!rideCard) {
      return;
    }

    const toggleNotesButton = event.target.closest('.toggle-notes');
    if (toggleNotesButton) {
      openNotesModal(decodeURIComponent(toggleNotesButton.dataset.notes || ''));
      return;
    }

    if (event.target.classList.contains('refresh-rides')) {
      await refresh();
      setFeedback('Ride list refreshed.');
    }

    if (event.target.classList.contains('manage-request')) {
      try {
        await api(`/api/requests/${event.target.dataset.requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            decision: event.target.dataset.decision,
          }),
        });
        await refresh();
        setFeedback(`Request ${event.target.dataset.decision}.`);
      } catch (error) {
        setFeedback(error.message, true);
      }
    }
  });

  container.addEventListener('submit', async (event) => {
    const requestForm = event.target.closest('[data-request-ride-id]');
    if (requestForm) {
      event.preventDefault();
      const rideId = requestForm.dataset.requestRideId;
      const formData = new FormData(requestForm);
      const message = String(formData.get('message') || '').trim();

      try {
        await api(`/api/rides/${rideId}/requests`, {
          method: 'POST',
          body: JSON.stringify({
            message,
          }),
        });
        await refresh();
        setFeedback('Seat request sent.');
      } catch (error) {
        setFeedback(error.message, true);
      }
      return;
    }

    const form = event.target.closest('[data-chat-ride-id]');
    if (!form) {
      return;
    }

    event.preventDefault();
    const rideId = form.dataset.chatRideId;
    const formData = new FormData(form);
    const text = String(formData.get('text') || '').trim();

    if (!text) {
      setFeedback('Write a message before sending.', true);
      return;
    }

    try {
      await api(`/api/rides/${rideId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
        }),
      });
      await refresh();
      setFeedback('Message sent.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

function ensureAuthenticated() {
  if (!state.currentUser) {
    redirectTo('login.html');
    return false;
  }

  hydrateUserPill();
  wireLogout();
  return true;
}

function ensureManager() {
  if (!userIsManager()) {
    redirectTo('dashboard.html');
    return false;
  }

  return true;
}

async function setupLandingPage() {
  if (state.currentUser) {
    redirectTo('dashboard.html');
  }
}

async function setupSignupPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('dashboard.html');
    return;
  }

  const officeSelect = document.querySelector('select[name="defaultOffice"]');
  syncSelectPlaceholderState(officeSelect);
  officeSelect?.addEventListener('change', () => {
    syncSelectPlaceholderState(officeSelect);
  });

  document.querySelector('#signup-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const profile = Object.fromEntries(formData.entries());

        try {
          const payload = await api('/api/auth/signup', {
            method: 'POST',
            body: JSON.stringify(profile),
          });

          state.currentUser = payload.profile;
          redirectTo('dashboard.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupLoginPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('dashboard.html');
    return;
  }

  document.querySelector('#login-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const credentials = {
          email: formData.get('email'),
          password: formData.get('password'),
        };

        try {
          const payload = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
          });

          state.currentUser = payload.profile;
          redirectTo('dashboard.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupDashboardPage() {
  const hubGrid = document.querySelector('.hub-grid');
  document.querySelector('#dashboard-title').textContent =
      `Welcome, ${state.currentUser.name}`;

  if (hubGrid && userIsManager()) {
    hubGrid.insertAdjacentHTML('beforeend', `
          <a href="debug.html" class="hub-card">
            <span class="hub-label">04</span>
            <h2>Debug data</h2>
            <p>Inspect all users, rides, requests, and ride chat data.</p>
          </a>
        `);
  }
}

async function setupCreateRidePage() {
  const form = document.querySelector('#ride-form');
  const carInput = form.querySelector('input[name="car"]');
  const startPointInput = form.querySelector('input[name="startPoint"]');
  const endPointInput = form.querySelector('input[name="endPoint"]');
  const dateInput = form.querySelector('input[name="rideDate"]');
  const startTimeInput = form.querySelector('input[name="startTime"]');
  const endTimeInput = form.querySelector('input[name="endTime"]');
  const swapRouteButton = document.querySelector('#swap-route-button');
  const today = new Date();
  const nextQuarterHour = roundUpToQuarterHour(today);

  dateInput.min = formatDateForInput(today);
  dateInput.value = formatDateForInput(today);
  startTimeInput.value = formatTimeForInput(nextQuarterHour);
  endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);

  if (!carInput.value) {
    carInput.value = state.currentUser.defaultCar || '';
  }

  applyUserRouteDefaults(form);

  syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);

  if (swapRouteButton) {
    swapRouteButton.addEventListener('click', () => {
      swapInputValues(startPointInput, endPointInput);
    });
  }

  dateInput.addEventListener('change', () => {
    syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
  });

  startTimeInput.addEventListener('change', () => {
    syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const ride = Object.fromEntries(formData.entries());

    try {
      const {startWindowStart, startWindowEnd} =
          validateRideDateTime(ride.rideDate, ride.startTime, ride.endTime);

      ride.startWindowStart = startWindowStart;
      ride.startWindowEnd = startWindowEnd;

      const payload = await api('/api/rides', {
        method: 'POST',
        body: JSON.stringify(ride),
      });
      form.reset();
      carInput.value = state.currentUser.defaultCar || '';
      applyUserRouteDefaults(form);
      dateInput.value = formatDateForInput(new Date());
      startTimeInput.value =
          formatTimeForInput(roundUpToQuarterHour(new Date()));
      endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
      syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
      setFeedback('Ride published successfully.');
      openRideCreatedModal(payload.ride);
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

async function setupSearchRidesPage() {
  const ridesList = document.querySelector('#rides-list');
  const searchForm = document.querySelector('#search-form');
  const resetButton = document.querySelector('#reset-search');

  const refresh = async () => {
    const rides = await loadRides(state.filters);
    ridesList.innerHTML = rides.length ?
        rides.map((ride) => renderRideCard(ride)).join('') :
        '<div class="empty-state">No rides found. Try adjusting the filters.</div>';
  };

  await refresh();
  await handleRideActions(ridesList, refresh);

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(searchForm);
    state.filters = {
      driver: String(formData.get('driver') || '').trim(),
      start: String(formData.get('start') || '').trim(),
      end: String(formData.get('end') || '').trim(),
      openOnly: formData.get('openOnly') === 'on',
    };

    try {
      await refresh();
      setFeedback('Ride list updated.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  resetButton.addEventListener('click', async () => {
    searchForm.reset();
    state.filters = {driver: '', start: '', end: '', openOnly: false};
    await refresh();
    setFeedback('Search filters cleared.');
  });
}

async function setupMyRidesPage() {
  const drivingContainer = document.querySelector('#my-driving-rides');
  const passengerContainer = document.querySelector('#my-passenger-rides');

  const refresh = async () => {
    const rides = await loadRides();
    const driving =
        rides.filter((ride) => ride.driverId === state.currentUser.id);
    const passenger = rides.filter(
        (ride) => ride.requests.some(
            (request) => request.passengerId === state.currentUser.id));

    drivingContainer.innerHTML = driving.length ?
        driving.map((ride) => renderRideCard(ride, {allowRequest: false}))
            .join('') :
        '<div class="empty-state">You have not created any rides yet.</div>';

    passengerContainer.innerHTML = passenger.length ?
        passenger.map((ride) => renderRideCard(ride, {allowRequest: false}))
            .join('') :
        '<div class="empty-state">You have not joined any rides yet.</div>';
  };

  await refresh();
  await handleRideActions(drivingContainer, refresh);
  await handleRideActions(passengerContainer, refresh);
}

function renderDebugSummary(profiles, rides) {
  const requestCount =
      rides.reduce((total, ride) => total + ride.requests.length, 0);
  const messageCount =
      rides.reduce((total, ride) => total + ride.messages.length, 0);

  return `
    <div class="debug-summary-grid">
      <article class="debug-stat-card">
        <strong>${profiles.length}</strong>
        <span>Profiles</span>
      </article>
      <article class="debug-stat-card">
        <strong>${rides.length}</strong>
        <span>Rides</span>
      </article>
      <article class="debug-stat-card">
        <strong>${requestCount}</strong>
        <span>Seat requests</span>
      </article>
      <article class="debug-stat-card">
        <strong>${messageCount}</strong>
        <span>Messages</span>
      </article>
    </div>
  `;
}

function renderDebugUser(profile, rides) {
  const email = profile.email.toLowerCase();
  const drivingRides =
      rides.filter((ride) => ride.driverEmail.toLowerCase() === email);
  const passengerRides = rides.filter(
      (ride) => ride.requests.some(
          (request) => request.passengerEmail.toLowerCase() === email));

  return `
    <article class="debug-card">
      <div class="debug-card-header">
        <div>
          <h3>${escapeHtml(profile.name || 'Unnamed user')}</h3>
          <p class="meta">${escapeHtml(profile.email)}</p>
        </div>
        <div class="pill-row">
          <span class="pill">Driving: ${drivingRides.length}</span>
          <span class="pill">Passenger: ${passengerRides.length}</span>
        </div>
      </div>

      <div class="debug-meta-grid">
        <div>
          <strong>Phone</strong>
          <div class="meta">${escapeHtml(profile.phone || '—')}</div>
        </div>
        <div>
          <strong>Default car</strong>
          <div class="meta">${escapeHtml(profile.defaultCar || '—')}</div>
        </div>
        <div>
          <strong>Default office</strong>
          <div class="meta">${
      escapeHtml(formatOfficeLocation(profile.defaultOffice) || '—')}</div>
        </div>
        <div>
          <strong>Default home</strong>
          <div class="meta">${escapeHtml(profile.defaultHome || '—')}</div>
        </div>
        <div>
          <strong>Created</strong>
          <div class="meta">${formatDateTime(profile.createdAt)}</div>
        </div>
      </div>

      <div class="debug-section-grid">
        <section class="debug-subsection">
          <h4>Rides as driver</h4>
          ${
      drivingRides.length ?
          `
            <ul class="debug-list">
              ${
              drivingRides
                  .map(
                      (ride) => `
                  <li>
                    <strong>${escapeHtml(ride.startPoint)} → ${
                          escapeHtml(ride.endPoint)}</strong>
                    <span class="meta">${
                          formatDateTime(ride.startWindowStart)} · Seats ${
                          ride.seatsLeft}/${ride.seatsTotal}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No rides created by this user.</div>'}
        </section>

        <section class="debug-subsection">
          <h4>Rides as passenger</h4>
          ${
      passengerRides.length ?
          `
            <ul class="debug-list">
              ${
              passengerRides
                  .map((ride) => {
                    const request = ride.requests.find(
                        (item) => item.passengerEmail.toLowerCase() === email);

                    return `
                  <li>
                    <strong>${escapeHtml(ride.startPoint)} → ${
                        escapeHtml(ride.endPoint)}</strong>
                    <span class="meta">Driver: ${
                        escapeHtml(
                            ride.driver?.name || ride.driverEmail)}</span>
                    <span class="pill status-${
                        escapeHtml(request?.status || 'pending')}">${
                        escapeHtml(request?.status || 'pending')}</span>
                  </li>
                `;
                  })
                  .join('')}
            </ul>
          ` :
          '<div class="empty-state">No passenger ride activity for this user.</div>'}
        </section>
      </div>
    </article>
  `;
}

function renderDebugRide(ride) {
  return `
    <article class="debug-card">
      <div class="debug-card-header">
        <div>
          <h3>${escapeHtml(ride.startPoint)} → ${escapeHtml(ride.endPoint)}</h3>
          <p class="meta">Ride ID: ${escapeHtml(ride.id)}</p>
        </div>
        <div class="pill-row">
          <span class="pill">Seats ${ride.seatsLeft}/${ride.seatsTotal}</span>
          <span class="pill">Requests ${ride.requests.length}</span>
          <span class="pill">Messages ${ride.messages.length}</span>
        </div>
      </div>

      <div class="debug-meta-grid">
        <div>
          <strong>Driver</strong>
          <div class="meta">${
      escapeHtml(ride.driver?.name || ride.driverEmail)}</div>
        </div>
        <div>
          <strong>Driver email</strong>
          <div class="meta">${escapeHtml(ride.driverEmail)}</div>
        </div>
        <div>
          <strong>Window</strong>
          <div class="meta">${formatDateTime(ride.startWindowStart)} - ${
      formatDateTime(ride.startWindowEnd)}</div>
        </div>
        <div>
          <strong>Car</strong>
          <div class="meta">${escapeHtml(ride.car || '—')}</div>
        </div>
      </div>

      <section class="debug-subsection">
        <h4>Notes</h4>
        <div class="meta">${
      escapeHtml(ride.notes || 'No notes for this ride.')}</div>
      </section>

      <div class="debug-section-grid">
        <section class="debug-subsection">
          <h4>Seat requests</h4>
          ${
      ride.requests.length ?
          `
            <ul class="debug-list">
              ${
              ride.requests
                  .map(
                      (request) => `
                  <li>
                    <strong>${
                          escapeHtml(
                              request.passenger?.name ||
                              request.passengerEmail)}</strong>
                    <span class="meta">${
                          escapeHtml(request.passengerEmail)} · ${
                          escapeHtml(request.message || 'No message')}</span>
                    <span class="pill status-${escapeHtml(request.status)}">${
                          escapeHtml(request.status)}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No seat requests yet.</div>'}
        </section>

        <section class="debug-subsection">
          <h4>Messages</h4>
          ${
      ride.messages.length ?
          `
            <ul class="debug-list">
              ${
              ride.messages
                  .map(
                      (message) => `
                  <li>
                    <strong>${
                          escapeHtml(
                              message.sender?.name ||
                              message.senderEmail)}</strong>
                    <span class="meta">${
                          formatDateTime(message.createdAt)}</span>
                    <span>${escapeHtml(message.text)}</span>
                  </li>
                `).join('')}
            </ul>
          ` :
          '<div class="empty-state">No chat messages yet.</div>'}
        </section>
      </div>
    </article>
  `;
}

async function setupDebugPage() {
  const summary = document.querySelector('#debug-summary');
  const usersContainer = document.querySelector('#debug-users-list');
  const ridesContainer = document.querySelector('#debug-rides-list');
  const refreshButton = document.querySelector('#debug-refresh');

  const refresh = async () => {
    const payload = await api('/api/admin/overview');
    const {profiles, rides} = payload;

    summary.innerHTML = renderDebugSummary(profiles, rides);
    usersContainer.innerHTML = profiles.length ?
        profiles.map((profile) => renderDebugUser(profile, rides)).join('') :
        '<div class="empty-state">No users found in the database.</div>';
    ridesContainer.innerHTML = rides.length ?
        rides.map((ride) => renderDebugRide(ride)).join('') :
        '<div class="empty-state">No rides found in the database.</div>';
  };

  await refresh();

  if (refreshButton) {
    refreshButton.addEventListener('click', async () => {
      try {
        await refresh();
        setFeedback('Debug data refreshed.');
      } catch (error) {
        setFeedback(error.message, true);
      }
    });
  }
}

async function setupProfilePage() {
  const form = document.querySelector('#profile-update-form');
  form.elements.name.value = state.currentUser.name || '';
  form.elements.email.value = state.currentUser.email || '';
  form.elements.phone.value = state.currentUser.phone || '';
  form.elements.defaultCar.value = state.currentUser.defaultCar || '';
  form.elements.defaultOffice.value = state.currentUser.defaultOffice || '';
  form.elements.defaultHome.value = state.currentUser.defaultHome || '';

  syncSelectPlaceholderState(form.elements.defaultOffice);
  form.elements.defaultOffice.addEventListener('change', () => {
    syncSelectPlaceholderState(form.elements.defaultOffice);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentEmail = state.currentUser.email;
    const formData = new FormData(form);
    const profile = Object.fromEntries(formData.entries());

    try {
      const payload =
          await api(`/api/profiles/${encodeURIComponent(currentEmail)}`, {
            method: 'PATCH',
            body: JSON.stringify(profile),
          });

      state.currentUser = payload.profile;
      hydrateUserPill();
      setFeedback('Profile updated successfully.');
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

async function init() {
  await loadCurrentUser();

  if (protectedPages.has(page) && !ensureAuthenticated()) {
    return;
  }

  if (page === 'debug' && !ensureManager()) {
    return;
  }

  switch (page) {
    case 'landing':
      await setupLandingPage();
      break;
    case 'signup':
      await setupSignupPage();
      break;
    case 'login':
      await setupLoginPage();
      break;
    case 'dashboard':
      await setupDashboardPage();
      break;
    case 'create-ride':
      await setupCreateRidePage();
      break;
    case 'search-rides':
      await setupSearchRidesPage();
      break;
    case 'my-rides':
      await setupMyRidesPage();
      break;
    case 'debug':
      await setupDebugPage();
      break;
    case 'profile':
      await setupProfilePage();
      break;
    default:
      break;
  }
}

init().catch((error) => {
  setFeedback(error.message, true);
});
