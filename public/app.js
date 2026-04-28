const page = document.body.dataset.page;
const protectedPages = new Set([
  'dashboard', 'create-ride', 'search-rides', 'my-rides', 'find-users',
  'profile', 'debug', 'messages'
]);

const state = {
  currentUser: null,
  clientConfig: null,
  clientConfigPromise: null,
  profiles: [],
  rides: [],
  filters: {
    driver: '',
    start: '',
    end: '',
    openOnly: false,
  },
};

const OFFICE_LOCATIONS = {
  LISBON: {
    label: 'Lisbon',
    address:
        'Avenida Aquilino Ribeiro Machado 8, 1800-142 Lisboa, Lisboa, Portugal',
  },
  PORTO: {
    label: 'Porto',
    address: 'Rua Dr. António Luis Gomes 10, 4000-091 Porto',
  },
  BRAGA: {
    label: 'Braga',
    address: 'Avenida Dom Joao II 374, 4715-275 Braga',
  },
};
const DEFAULT_MAPBOX_PROXIMITY = {
  longitude: -9.1393,
  latitude: 38.7223,
};
const DEFAULT_LOCATION_MAP_CENTER = [-9.1393, 38.7223];
const DEFAULT_LOCATION_MAP_ZOOM = 10.8;

const PENDING_TOAST_KEY = 'ridesapp.pendingToast';
const PROFILE_RETURN_PATH_KEY = 'ridesapp.profileReturnPath';
const CREATE_RIDE_RETURN_PATH_KEY = 'ridesapp.createRideReturnPath';
const PASSWORD_REQUIREMENTS_MESSAGE =
    'Password must be at least 8 characters long.';

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

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8;
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

function setPendingToast(message, tone = 'success') {
  sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({message, tone}));
}

function consumePendingToast() {
  const rawToast = sessionStorage.getItem(PENDING_TOAST_KEY);
  if (!rawToast) {
    return null;
  }

  sessionStorage.removeItem(PENDING_TOAST_KEY);

  try {
    return JSON.parse(rawToast);
  } catch {
    return null;
  }
}

function getCurrentPagePath() {
  const path = window.location.pathname.split('/').pop();
  return path || 'index.html';
}

function setReturnPath(storageKey, path) {
  if (!path) {
    return;
  }

  sessionStorage.setItem(storageKey, path);
}

function consumeReturnPath(storageKey, fallbackPath) {
  const returnPath = sessionStorage.getItem(storageKey);
  if (returnPath) {
    sessionStorage.removeItem(storageKey);
    return returnPath;
  }

  return fallbackPath;
}

function showPendingToastIfPresent() {
  const pendingToast = consumePendingToast();
  if (pendingToast?.message) {
    showToast(pendingToast.message, pendingToast.tone);
  }
}

function wireReturnPathLinks() {
  const currentPath = getCurrentPagePath();

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) {
      return;
    }

    const href = link.getAttribute('href');
    if (href === 'profile.html') {
      setReturnPath(PROFILE_RETURN_PATH_KEY, currentPath);
    }

    if (href === 'create-ride.html') {
      setReturnPath(CREATE_RIDE_RETURN_PATH_KEY, currentPath);
    }
  });
}

function ensureToastContainer() {
  let container = document.querySelector('#toast-container');
  if (container) {
    return container;
  }

  document.body.insertAdjacentHTML(
      'beforeend', '<div id="toast-container" class="toast-container"></div>');
  container = document.querySelector('#toast-container');
  return container;
}

function showToast(message, tone = 'success') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  window.setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');

    window.setTimeout(() => {
      toast.remove();
    }, 280);
  }, 2000);
}

function debounce(callback, delay) {
  let timeoutId = null;

  const debounced = (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      callback(...args);
    }, delay);
  };

  debounced.cancel = () => {
    window.clearTimeout(timeoutId);
    timeoutId = null;
  };

  return debounced;
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

async function loadClientConfig() {
  if (state.clientConfig) {
    return state.clientConfig;
  }

  if (!state.clientConfigPromise) {
    state.clientConfigPromise = api('/api/client-config')
                                    .then((payload) => {
                                      state.clientConfig = payload;
                                      return payload;
                                    })
                                    .finally(() => {
                                      state.clientConfigPromise = null;
                                    });
  }

  return state.clientConfigPromise;
}

async function fetchMapboxLocationSuggestions(query, signal) {
  const config = await loadClientConfig();
  const token = String(config?.mapboxPublicToken || '').trim();

  if (!token) {
    throw new Error('Mapbox token is missing.');
  }

  if (query.trim().length < 3) {
    return [];
  }

  const params = new URLSearchParams({
    access_token: token,
    autocomplete: 'true',
    limit: '5',
    language: 'pt',
    proximity: `${DEFAULT_MAPBOX_PROXIMITY.longitude},${
        DEFAULT_MAPBOX_PROXIMITY.latitude}`,
    types: 'place,address,poi,locality,neighborhood,region',
  });

  const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${
          encodeURIComponent(query)}.json?${params.toString()}`,
      {signal});

  if (!response.ok) {
    throw new Error('Unable to load location suggestions.');
  }

  const payload = await response.json();
  return (payload.features || [])
      .map((feature) => ({
             id: feature.id,
             name: feature.text || feature.place_name || '',
             label: feature.place_name || feature.text || '',
           }));
}

async function fetchMapboxLocationFeature(query, signal) {
  const config = await loadClientConfig();
  const token = String(config?.mapboxPublicToken || '').trim();

  if (!token) {
    throw new Error('Mapbox token is missing.');
  }

  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return null;
  }

  const params = new URLSearchParams({
    access_token: token,
    autocomplete: 'false',
    limit: '1',
    language: 'pt',
    proximity: `${DEFAULT_MAPBOX_PROXIMITY.longitude},${
        DEFAULT_MAPBOX_PROXIMITY.latitude}`,
    types: 'address,poi,place,locality,neighborhood,region',
  });

  const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${
          encodeURIComponent(trimmedQuery)}.json?${params.toString()}`,
      {signal});

  if (!response.ok) {
    throw new Error('Unable to find that location on the map.');
  }

  const payload = await response.json();
  return payload.features?.[0] || null;
}

async function reverseGeocodeMapboxLocation(longitude, latitude, signal) {
  const config = await loadClientConfig();
  const token = String(config?.mapboxPublicToken || '').trim();

  if (!token) {
    throw new Error('Mapbox token is missing.');
  }

  const params = new URLSearchParams({
    access_token: token,
    language: 'pt',
    limit: '1',
    types: 'address,poi,place,locality,neighborhood',
  });

  const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${
          latitude}.json?${params.toString()}`,
      {signal});

  if (!response.ok) {
    throw new Error('Unable to resolve the dropped pin.');
  }

  const payload = await response.json();
  return payload.features?.[0] || null;
}

function formatLocationCoordinates(longitude, latitude) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function getPrimaryLocationLabel(value) {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue) {
    return '';
  }

  const officeLocation = getOfficeLocationByAddress(trimmedValue);
  if (officeLocation) {
    return formatOfficeLocation(officeLocation);
  }

  return trimmedValue.split(',')[0].trim() || trimmedValue;
}

function formatRideRouteLabel(ride, separator = ' → ') {
  const startLabel = getPrimaryLocationLabel(ride?.startPoint);
  const endLabel = getPrimaryLocationLabel(ride?.endPoint);

  return `${startLabel || '—'}${separator}${endLabel || '—'}`;
}

function getLocationFieldElements(fieldName, scope = document) {
  const hiddenInput =
      scope.querySelector(`input[type="hidden"][name="${fieldName}"]`) ||
      scope.querySelector(`input[name="${fieldName}"]`);
  const displayInput =
      scope.querySelector(`input[name="${fieldName}Display"]`) || hiddenInput;

  return {
    hiddenInput,
    displayInput,
  };
}

function setLocationFieldValue(
    fieldName, fullValue, scope = document, options = {}) {
  const {hiddenInput, displayInput} =
      getLocationFieldElements(fieldName, scope);
  const normalizedValue = String(fullValue || '').trim();
  const displayValue =
      String(options.displayValue ?? getPrimaryLocationLabel(normalizedValue));

  if (hiddenInput) {
    hiddenInput.value = normalizedValue;
  }

  if (displayInput) {
    displayInput.value = displayValue;
  }
}

function syncLocationFieldFromDisplayInput(input) {
  if (!input) {
    return;
  }

  const fieldName = String(input.dataset.locationField || '').trim();
  if (!fieldName) {
    return;
  }

  const form = input.form || document;
  const {hiddenInput} = getLocationFieldElements(fieldName, form);
  if (!hiddenInput || hiddenInput === input) {
    return;
  }

  hiddenInput.value = input.value.trim();
}

function initializeLocationAutocomplete(input) {
  if (!input) {
    return;
  }

  const field = input.closest('label');
  if (!field || field.querySelector('.location-autocomplete-results')) {
    return;
  }

  const fieldName = String(input.dataset.locationField || '').trim();
  if (fieldName) {
    const form = input.form || document;
    const {hiddenInput} = getLocationFieldElements(fieldName, form);
    if (hiddenInput && hiddenInput !== input && !hiddenInput.value.trim()) {
      syncLocationFieldFromDisplayInput(input);
    }
  }

  field.classList.add('location-autocomplete-field');
  const results = document.createElement('div');
  results.className = 'location-autocomplete-results';
  results.hidden = true;
  field.appendChild(results);

  let activeRequestController = null;

  const clearResults = () => {
    results.hidden = true;
    results.innerHTML = '';
  };

  const renderSuggestions = (suggestions) => {
    if (!suggestions.length) {
      clearResults();
      return;
    }

    results.innerHTML = suggestions
                            .map(
                                (suggestion) => `
      <button type="button" class="location-autocomplete-option" data-location-value="${
                                    escapeHtml(suggestion.label)}">
        <span class="location-autocomplete-primary">${
                                    escapeHtml(suggestion.name)}</span>
        <span class="location-autocomplete-secondary">${
                                    escapeHtml(suggestion.label)}</span>
      </button>
    `).join('');
    results.hidden = false;
  };

  const scheduleSearch = debounce(async () => {
    const query = input.value.trim();
    if (query.length < 3) {
      clearResults();
      return;
    }

    activeRequestController?.abort();
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      const suggestions =
          await fetchMapboxLocationSuggestions(query, requestController.signal);

      if (activeRequestController !== requestController) {
        return;
      }

      renderSuggestions(suggestions);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      clearResults();
    }
  }, 250);

  input.addEventListener('input', () => {
    syncLocationFieldFromDisplayInput(input);
    scheduleSearch();
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 3) {
      scheduleSearch();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      clearResults();
    }, 150);
  });

  results.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  results.addEventListener('click', (event) => {
    const option = event.target.closest('[data-location-value]');
    if (!option) {
      return;
    }

    const form = input.form || document;
    const fieldName = input.dataset.locationField;
    if (fieldName) {
      setLocationFieldValue(fieldName, option.dataset.locationValue, form);
    } else {
      input.value = option.dataset.locationValue;
    }
    clearResults();
  });
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

function formatCalendarDate(value) {
  return new Intl
      .DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      .format(new Date(value));
}

function formatClockTime(value) {
  return new Intl
      .DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
      .format(new Date(value));
}

function getCalendarDayKey(value) {
  const parts = new Intl
                    .DateTimeFormat(undefined, {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                    })
                    .formatToParts(new Date(value));

  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';

  return `${year}-${month}-${day}`;
}

function isSameCalendarDay(leftValue, rightValue) {
  return getCalendarDayKey(leftValue) === getCalendarDayKey(rightValue);
}

function formatDateTimeRange(startValue, endValue) {
  if (!startValue || !endValue) {
    return startValue ? formatDateTime(startValue) : '—';
  }

  if (isSameCalendarDay(startValue, endValue)) {
    return `${formatCalendarDate(startValue)}, ${
        formatClockTime(startValue)} - ${formatClockTime(endValue)}`;
  }

  return `${formatDateTime(startValue)}
${formatDateTime(endValue)}`;
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

function parseTimeValueToMinutes(timeValue) {
  const [hours, minutes] =
      String(timeValue || '').split(':').map((value) => Number(value));

  if ([hours, minutes].some((value) => Number.isNaN(value))) {
    return null;
  }

  return hours * 60 + minutes;
}

function shouldTreatEndTimeAsNextDay(startTime, endTime) {
  const startMinutes = parseTimeValueToMinutes(startTime);
  const endMinutes = parseTimeValueToMinutes(endTime);

  if (startMinutes === null || endMinutes === null ||
      endMinutes > startMinutes) {
    return false;
  }

  return startMinutes >= 22 * 60 && startMinutes - endMinutes > 20 * 60;
}

function floorToMinute(date) {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  return normalized;
}

function roundUpToNextMinute(date) {
  const rounded = floorToMinute(date);

  if (date.getSeconds() !== 0 || date.getMilliseconds() !== 0) {
    rounded.setMinutes(rounded.getMinutes() + 1);
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
  const now = floorToMinute(new Date());

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Please choose a valid departure window.');
  }

  if (shouldTreatEndTimeAsNextDay(startTime, endTime)) {
    end.setDate(end.getDate() + 1);
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
    const minStartTime = formatTimeForInput(floorToMinute(now));

    if (!startTimeInput.value) {
      startTimeInput.value = minStartTime;
    }
  }

  if (!endTimeInput.value) {
    endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
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

let activeRideDetailsRefresh = null;
let pendingRidePublish = null;

function ensureRideDetailsModal() {
  let modal = document.querySelector('#ride-details-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-details-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-ride-details-modal="true"></div>
      <div class="notes-modal-panel ride-details-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-details-modal-title">
        <div class="notes-modal-header">
          <h2 id="ride-details-modal-title" class="ride-details-title">Ride details</h2>
          <div class="ride-details-close-buttons">
            <button type="button" class="button-secondary notes-modal-close ride-details-close-button-text" data-close-ride-details-modal="true" aria-label="Close ride details">Close</button>
            <button type="button" class="button-secondary notes-modal-close ride-details-close-button-icon" data-close-ride-details-modal="true" aria-label="Close ride details">&times;</button>
          </div>
        </div>
        <div id="ride-details-modal-content" class="ride-details-modal-content"></div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-details-modal');
  modal.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-ride-details-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    const manageRequestButton = event.target.closest('.manage-request');
    if (manageRequestButton) {
      try {
        await api(`/api/requests/${manageRequestButton.dataset.requestId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            decision: manageRequestButton.dataset.decision,
          }),
        });
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
        showToast(`Request ${manageRequestButton.dataset.decision}.`);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    try {
      const removePassengerButton =
          event.target.closest('.remove-passenger-button');
      if (removePassengerButton) {
        await api(`/api/requests/${removePassengerButton.dataset.requestId}`, {
          method: 'DELETE',
        });
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
        showToast('Passenger removed from ride.');
        return;
      }

      const leaveRideButton = event.target.closest('.leave-ride-button');
      if (!leaveRideButton) {
        return;
      }

      await leaveRide(leaveRideButton.dataset.requestId, async () => {
        await refreshRideDetailsModal();
        if (activeRideDetailsRefresh) {
          await activeRideDetailsRefresh();
        }
      });
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  modal.addEventListener('submit', async (event) => {
    const requestForm = event.target.closest('[data-request-ride-id]');
    if (requestForm) {
      event.preventDefault();

      try {
        await requestSeatForRide(
            requestForm.dataset.requestRideId, async () => {
              await refreshRideDetailsModal();
              if (activeRideDetailsRefresh) {
                await activeRideDetailsRefresh();
              }
            });
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const chatForm = event.target.closest('.chat-form');
    if (!chatForm) {
      return;
    }

    event.preventDefault();
    const rideId = chatForm.dataset.chatRideId;
    const formData = new FormData(chatForm);
    const text = String(formData.get('text') || '').trim();

    if (!text) {
      showToast('Write a message before sending.', 'error');
      return;
    }

    try {
      await api(`/api/rides/${rideId}/messages`, {
        method: 'POST',
        body: JSON.stringify({text}),
      });
      await refreshRideDetailsModal();
      if (activeRideDetailsRefresh) {
        await activeRideDetailsRefresh();
      }
      showToast('Message sent.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  return modal;
}

function renderRideDetailsContent(ride) {
  const isDriver = state.currentUser && ride.driverId === state.currentUser.id;
  const currentRequest = getCurrentUserRequest(ride);
  const driverName = ride.driver?.name || ride.driverEmail;
  const notes = String(ride.notes || '').trim() || 'No notes for this ride.';

  return `
    <div class="ride-details-summary">
     <div class="ride-details-grid-driver">
        <strong>Driver:</strong>
        <div class="ride-details-grid-driver-name">${
      escapeHtml(driverName)}</div>
      </div>
      <div class="card-grid ride-details-grid">
        <div class="ride-details-grid-window">
          <strong>Window</strong>
          <div class="meta">${
      escapeHtml(formatDateTimeRange(
          ride.startWindowStart, ride.startWindowEnd))}</div>
        </div>
        <div class="ride-details-grid-car">
          <strong>Car</strong>
          <div class="meta">${escapeHtml(ride.car || '—')}</div>
        </div>
        <div class="ride-details-grid-seats">
          <strong>Seats left</strong>
          <div class="meta">${ride.seatsLeft} / ${ride.seatsTotal}</div>
        </div>
        <div class="ride-details-grid-requests">
          <strong>Requests</strong>
          <div class="meta">${ride.requests.length}</div>
        </div>
      </div>
      <div class="pill-row">
        ${renderRideAvailabilityPill(ride)}
        ${
      currentRequest ?
          `<span class="pill status-${currentRequest.status}">Your request: ${
              escapeHtml(currentRequest.status)}</span>` :
          ''}
      </div>
      ${renderRideSeatAction(ride, {
    compact: true
  })}
    </div>

    <section class="ride-details-section">
      <h3>Notes</h3>
      <div class="ride-details-notes">${escapeHtml(notes)}</div>
    </section>

    ${isDriver ? renderDriverRequests(ride) : ''}
    ${renderChat(ride)}
  `;
}

async function refreshRideDetailsModal() {
  const modal = ensureRideDetailsModal();
  const rideId = modal.dataset.rideId;

  if (!rideId) {
    return;
  }

  const content = modal.querySelector('#ride-details-modal-content');
  const payload = await api(`/api/rides/${rideId}`);
  const ride = payload.ride;


  modal.querySelector('#ride-details-modal-title').innerHTML =
      `<span class="ride-details-title-text">${
          escapeHtml(`${formatRideRouteLabel(ride)}`)}</span>`;
  content.innerHTML = renderRideDetailsContent(ride);
}

async function openRideDetailsModal(rideId, refresh) {
  const modal = ensureRideDetailsModal();
  const content = modal.querySelector('#ride-details-modal-content');

  activeRideDetailsRefresh = refresh;
  modal.dataset.rideId = rideId;
  modal.hidden = false;
  modal.querySelector('#ride-details-modal-title').textContent = 'Ride details';
  content.innerHTML = '<div class="empty-state">Loading ride details...</div>';

  try {
    await refreshRideDetailsModal();
  } catch (error) {
    modal.hidden = true;
    showToast(error.message, 'error');
  }
}

async function requestSeatForRide(rideId, refresh) {
  await api(`/api/rides/${rideId}/requests`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  await refresh();
  showToast('Seat request sent.');
}

async function leaveRide(requestId, refresh) {
  await api(`/api/requests/${requestId}`, {
    method: 'DELETE',
  });
  await refresh();
  showToast('You left the ride.');
}

function renderRideSummaryMarkup(ride, options = {}) {
  const {
    emptyCarLabel = 'No car specified',
    emptyNotesLabel = 'No notes added.',
    showNotes = false,
  } = options;
  const carLabel = String(ride.car || '').trim() || emptyCarLabel;
  const notes = String(ride.notes || '').trim();

  return `
    <div class="ride-created-route">${
      escapeHtml(formatRideRouteLabel(ride, ' to '))}</div>
    <div class="ride-created-meta">${
      escapeHtml(formatDateTimeRange(
          ride.startWindowStart, ride.startWindowEnd))}</div>
    <div class="ride-created-meta">${escapeHtml(carLabel)} · ${
      escapeHtml(ride.seatsTotal)} seat${
      Number(ride.seatsTotal) === 1 ? '' : 's'}</div>
    ${
      showNotes ? `<div class="ride-created-meta">Notes: ${
                      escapeHtml(notes || emptyNotesLabel)}</div>` :
                  ''}
  `;
}

function ensureRidePublishModal() {
  let modal = document.querySelector('#ride-publish-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="ride-publish-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-ride-publish-action="dismiss"></div>
      <div class="notes-modal-panel ride-publish-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ride-publish-modal-title">
        <div class="ride-publish-modal-header">
          <h2 id="ride-publish-modal-title"></h2>
          <div class="ride-publish-close-buttons">
            <button type="button" class="button-secondary notes-modal-close ride-publish-close-button-text" data-ride-publish-close-button data-ride-publish-action="dismiss" aria-label="Close ride publish dialog">Close</button>
            <button type="button" class="button-secondary notes-modal-close ride-publish-close-button-icon" data-ride-publish-close-button data-ride-publish-action="dismiss" aria-label="Close ride publish dialog">&times;</button>
          </div>
        </div>
        <p id="ride-publish-copy" class="ride-publish-copy"></p>
        <div id="ride-publish-summary" class="ride-publish-summary"></div>
        <div id="ride-publish-actions" class="ride-publish-actions"></div>
      </div>
    </div>
  `);

  modal = document.querySelector('#ride-publish-modal');
  modal.addEventListener('click', async (event) => {
    const actionTrigger = event.target.closest('[data-ride-publish-action]');
    if (!actionTrigger) {
      return;
    }

    const action = actionTrigger.dataset.ridePublishAction;

    if (action === 'dismiss' || action === 'edit-ride' ||
        action === 'create-another') {
      modal.hidden = true;
      return;
    }

    if (action === 'return-after-publish') {
      redirectTo(
          consumeReturnPath(CREATE_RIDE_RETURN_PATH_KEY, 'dashboard.html'));
      return;
    }

    if (action === 'view-my-rides') {
      redirectTo('my-rides.html');
      return;
    }

    if (action !== 'confirm-publish' || !pendingRidePublish) {
      return;
    }

    const confirmButton = actionTrigger;
    const {ride, form, carInput, dateInput, startTimeInput, endTimeInput} =
        pendingRidePublish;

    try {
      confirmButton.disabled = true;
      const payload = await api('/api/rides', {
        method: 'POST',
        body: JSON.stringify(ride),
      });

      form.reset();
      carInput.value = state.currentUser.defaultCar || '';
      applyUserRouteDefaults(form);
      dateInput.value = formatDateForInput(new Date());
      startTimeInput.value =
          formatTimeForInput(roundUpToNextMinute(new Date()));
      endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);
      syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);
      pendingRidePublish = null;
      setRidePublishModalState({
        mode: 'success',
        ride: payload.ride,
      });
    } catch (error) {
      setFeedback(error.message, true);
      confirmButton.disabled = false;
    }
  });

  return modal;
}

function setRidePublishModalState({mode, ride}) {
  const modal = ensureRidePublishModal();
  const title = modal.querySelector('#ride-publish-modal-title');
  const copy = modal.querySelector('#ride-publish-copy');
  const summary = modal.querySelector('#ride-publish-summary');
  const actions = modal.querySelector('#ride-publish-actions');
  const closeButtons =
      Array.from(modal.querySelectorAll('[data-ride-publish-close-button]'));

  if (mode === 'success') {
    title.textContent = 'Ride published successfully';
    copy.textContent = 'Your ride is now visible to others.';
    summary.innerHTML = renderRideSummaryMarkup(ride);
    actions.innerHTML = `
      <button type="button" class="button-secondary" data-ride-publish-action="create-another">Create another</button>
      <button type="button" data-ride-publish-action="view-my-rides">See my rides</button>
    `;
    closeButtons.forEach((closeButton) => {
      closeButton.dataset.ridePublishAction = 'return-after-publish';
      closeButton.setAttribute('aria-label', 'Close confirmation');
    });
    modal.hidden = false;
    return modal;
  }

  title.textContent = 'Confirm your ride details';
  copy.textContent =
      'Review the details below. Your ride will only be published after you confirm.';
  summary.innerHTML = renderRideSummaryMarkup(ride, {
    showNotes: true,
  });
  actions.innerHTML = `
    <button type="button" class="button-secondary" data-ride-publish-action="edit-ride">Edit ride</button>
    <button type="button" id="ride-confirm-submit" data-ride-publish-action="confirm-publish">Confirm and publish</button>
  `;
  closeButtons.forEach((closeButton) => {
    closeButton.dataset.ridePublishAction = 'dismiss';
    closeButton.setAttribute('aria-label', 'Close ride confirmation');
  });
  modal.hidden = false;
  return modal;
}

function openRideConfirmModal(pendingRide) {
  pendingRidePublish = pendingRide;
  setRidePublishModalState({
    mode: 'confirm',
    ride: pendingRide.ride,
  });
}

function openRideCreatedModal(ride) {
  pendingRidePublish = null;
  setRidePublishModalState({
    mode: 'success',
    ride,
  });
}

function deleteCurrentAccount() {
  return api('/api/profile', {
    method: 'DELETE',
  });
}

function ensureDeleteAccountModal() {
  let modal = document.querySelector('#delete-account-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="delete-account-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-dismiss-delete-account-modal="true"></div>
      <div class="notes-modal-panel ride-created-modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-account-modal-title">
        <div class="notes-modal-header">
          <h2 id="delete-account-modal-title">Delete account</h2>
        </div>
        <p class="ride-created-copy">Once you delete your account, there is no going back. This will remove your profile, your published rides, and your joined rides.</p>
        <div class="ride-created-actions">
          <button type="button" class="button-secondary" data-dismiss-delete-account-modal="true">Cancel</button>
          <button type="button" id="delete-account-confirm-button" class="danger-button">Delete account</button>
        </div>
      </div>
    </div>
  `);

  modal = document.querySelector('#delete-account-modal');
  modal.addEventListener('click', async (event) => {
    if (event.target.closest('[data-dismiss-delete-account-modal="true"]')) {
      modal.hidden = true;
      return;
    }

    const confirmButton =
        event.target.closest('#delete-account-confirm-button');
    if (!confirmButton) {
      return;
    }

    try {
      confirmButton.disabled = true;
      await deleteCurrentAccount();
      state.currentUser = null;
      redirectTo('index.html');
    } catch (error) {
      setFeedback(error.message, true);
      confirmButton.disabled = false;
    }
  });

  return modal;
}

function openDeleteAccountModal() {
  const modal = ensureDeleteAccountModal();
  const confirmButton = modal.querySelector('#delete-account-confirm-button');

  confirmButton.disabled = false;
  modal.hidden = false;
}

function formatOfficeLocation(value) {
  const label = OFFICE_LOCATIONS[value]?.label || '';
  return label ? `${label} office` : '';
}

function getOfficeAddress(value) {
  return OFFICE_LOCATIONS[value]?.address || '';
}

function getOfficeLocationByAddress(address) {
  const normalizedAddress = String(address || '').trim().toLowerCase();
  if (!normalizedAddress) {
    return '';
  }

  return Object.entries(OFFICE_LOCATIONS)
             .find(([, office]) => {
               return String(office.address || '').trim().toLowerCase() ===
                   normalizedAddress;
             })
             ?.[0] ||
      '';
}

function syncSelectPlaceholderState(select) {
  if (!select) {
    return;
  }

  select.classList.toggle('select-placeholder', !select.value);
}

function applyUserRouteDefaults(form) {
  const {hiddenInput: startPointInput} =
      getLocationFieldElements('startPoint', form);
  const {hiddenInput: endPointInput} =
      getLocationFieldElements('endPoint', form);

  if (startPointInput && !startPointInput.value) {
    setLocationFieldValue(
        'startPoint', state.currentUser.defaultStartingLocation || '', form);
  }

  if (endPointInput && !endPointInput.value) {
    setLocationFieldValue(
        'endPoint', getOfficeAddress(state.currentUser.defaultOffice), form, {
          displayValue: formatOfficeLocation(state.currentUser.defaultOffice),
        });
  }
}

function swapLocationFieldValues(
    firstFieldName, secondFieldName, scope = document) {
  const firstField = getLocationFieldElements(firstFieldName, scope);
  const secondField = getLocationFieldElements(secondFieldName, scope);
  const firstValue = firstField.hiddenInput?.value || '';
  const secondValue = secondField.hiddenInput?.value || '';

  setLocationFieldValue(firstFieldName, secondValue, scope);
  setLocationFieldValue(secondFieldName, firstValue, scope);
}

function wireLogout() {
  const logoutButtons =
      document.querySelectorAll('[data-logout-button], #logout-button');
  if (!logoutButtons.length) {
    return;
  }

  logoutButtons.forEach((logoutButton) => {
    if (logoutButton.dataset.logoutWired === 'true') {
      return;
    }

    logoutButton.dataset.logoutWired = 'true';
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
  });
}

function setupMobileMenus() {
  const menuButtons =
      Array.from(document.querySelectorAll('[data-mobile-menu-button]'));

  if (!menuButtons.length) {
    return;
  }

  const closeAllMenus = ({exceptButton = null} = {}) => {
    menuButtons.forEach((menuButton) => {
      const panelId = menuButton.getAttribute('aria-controls');
      const menuPanel = panelId ? document.getElementById(panelId) : null;

      if (!menuPanel || menuButton === exceptButton) {
        return;
      }

      menuPanel.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
    });
  };

  const setMenuButtonsVisible = (isVisible) => {
    menuButtons.forEach((menuButton) => {
      menuButton.classList.toggle(
          'mobile-menu-button-scroll-hidden', !isVisible);
    });
  };

  const syncMenuButtonsVisibility = (() => {
    const mobileBreakpoint = 760;
    const topVisibleThreshold = 24;
    const showOnScrollUpDelta = 18;
    const hideOnScrollDownDelta = 28;
    let lastScrollY = window.scrollY;
    let upwardTravel = 0;
    let downwardTravel = 0;

    return () => {
      if (window.innerWidth > mobileBreakpoint) {
        upwardTravel = 0;
        downwardTravel = 0;
        lastScrollY = window.scrollY;
        setMenuButtonsVisible(true);
        return;
      }

      const currentScrollY = Math.max(window.scrollY, 0);
      const hasOpenMenu = menuButtons.some(
          (menuButton) => menuButton.getAttribute('aria-expanded') === 'true');

      if (hasOpenMenu || currentScrollY <= topVisibleThreshold) {
        upwardTravel = 0;
        downwardTravel = 0;
        lastScrollY = currentScrollY;
        setMenuButtonsVisible(true);
        return;
      }

      const delta = currentScrollY - lastScrollY;
      if (Math.abs(delta) < 2) {
        return;
      }

      if (delta > 0) {
        downwardTravel += delta;
        upwardTravel = 0;
        if (downwardTravel >= hideOnScrollDownDelta) {
          setMenuButtonsVisible(false);
        }
      } else {
        upwardTravel += Math.abs(delta);
        downwardTravel = 0;
        if (upwardTravel >= showOnScrollUpDelta) {
          setMenuButtonsVisible(true);
        }
      }

      lastScrollY = currentScrollY;
    };
  })();

  menuButtons.forEach((menuButton) => {
    if (menuButton.dataset.mobileMenuWired === 'true') {
      return;
    }

    const panelId = menuButton.getAttribute('aria-controls');
    const menuPanel = panelId ? document.getElementById(panelId) : null;

    if (!menuPanel) {
      return;
    }

    menuButton.dataset.mobileMenuWired = 'true';
    menuButton.addEventListener('click', () => {
      const shouldOpen = menuPanel.hidden;
      closeAllMenus({exceptButton: shouldOpen ? menuButton : null});
      menuPanel.hidden = !shouldOpen;
      menuButton.setAttribute('aria-expanded', String(shouldOpen));
      syncMenuButtonsVisibility();
    });

    menuPanel.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) {
        closeAllMenus();
        syncMenuButtonsVisibility();
      }
    });
  });

  if (document.body.dataset.mobileMenusGlobalWired === 'true') {
    return;
  }

  document.body.dataset.mobileMenusGlobalWired = 'true';

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-mobile-menu-button]') ||
        event.target.closest('[data-mobile-menu-panel]')) {
      return;
    }

    closeAllMenus();
    syncMenuButtonsVisibility();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllMenus();
      syncMenuButtonsVisibility();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) {
      closeAllMenus();
    }

    syncMenuButtonsVisibility();
  });

  window.addEventListener('scroll', syncMenuButtonsVisibility, {passive: true});
  syncMenuButtonsVisibility();
}

function syncLandingPageAuthState() {
  const guestHeaderActions = document.querySelectorAll(
      '#landing-guest-actions, #landing-mobile-guest-actions');
  const authHeaderActions = document.querySelectorAll(
      '#landing-auth-actions, #landing-mobile-auth-actions');
  const isAuthenticated = Boolean(state.currentUser);

  guestHeaderActions.forEach((element) => {
    element.hidden = isAuthenticated;
  });

  authHeaderActions.forEach((element) => {
    element.hidden = !isAuthenticated;
  });

  if (isAuthenticated) {
    wireLogout();
  }
}

async function loadProfiles(searchQuery = '', options = {}) {
  const params = new URLSearchParams();

  if (String(searchQuery || '').trim()) {
    params.set('query', searchQuery.trim());
  }

  const payload = await api(
      `/api/profiles${params.toString() ? `?${params.toString()}` : ''}`,
      options);
  state.profiles = payload.profiles;
  return payload.profiles;
}

function renderUserSearchCard(profile) {
  const isSelf = state.currentUser && state.currentUser.id === profile.id;
  const messageButton = isSelf ?
      '' :
      `
    <a href="messages.html?user=${
          encodeURIComponent(
              profile
                  .id)}" class="dm-user-card-button" aria-label="Send message to ${
          escapeHtml(profile.name)}" title="Send message">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </a>
  `;

  return `
    <article class="user-card">
      <div class="user-card-header">
        <div>
          <h2>${
      escapeHtml(profile.name || 'Unnamed user')} <span class="meta">- ${
      escapeHtml(profile.publicId || '—')}</span></h2>
        </div>
        ${messageButton}
      </div>
      <p class="meta"><strong>Default office:</strong> ${
      escapeHtml(formatOfficeLocation(profile.defaultOffice) || '—')}</p>
    </article>
  `;
}

async function loadRides(filters = {}, options = {}) {
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
      `/api/rides${params.toString() ? `?${params.toString()}` : ''}`, options);
  state.rides = payload.rides;
  return payload.rides;
}

function getCurrentUserRequest(ride) {
  if (!state.currentUser) {
    return null;
  }

  return ride.requests.find(
      (request) => request.passengerId === state.currentUser.id &&
          ['pending', 'accepted'].includes(request.status));
}

function renderRideSeatAction(ride, options = {}) {
  const {allowRequest = true, compact = false} = options;
  const isDriver = state.currentUser && ride.driverId === state.currentUser.id;
  const currentRequest = getCurrentUserRequest(ride);

  if (currentRequest) {
    return `
      <div class="request-form${compact ? ' request-form-compact' : ''}">
        <button type="button" class="leave-ride-button" data-request-id="${
        currentRequest.id}">Leave ride</button>
      </div>
    `;
  }

  if (!allowRequest || !state.currentUser || isDriver || ride.seatsLeft <= 0) {
    return '';
  }

  return `
    <form class="request-form${
      compact ? ' request-form-compact' :
                ''}" data-request-ride-id="${ride.id}">
      <button type="submit">Request seat</button>
    </form>
  `;
}

function renderRideAvailabilityPill(ride, extraClass = '') {
  const statusClass =
      ride.seatsLeft === 0 ? 'status-declined' : 'status-accepted';
  const label = ride.seatsLeft === 0 ? 'Full' : 'Open';

  return `<span class="pill ${statusClass}${
      extraClass ? ` ${extraClass}` : ''}">${label}</span>`;
}

function renderDriverRequests(ride) {
  if (!ride.requests.length) {
    return '<div class="empty-state">No passenger requests yet.</div>';
  }

  return `
    <section class="ride-driver-requests-section">
      <h3>Passenger requests</h3>
      <ul class="request-list ride-driver-requests-list">
        ${
      ride.requests
          .map(
              (request) => `
              <li>
                <div class="request-item">
                  <div class="request-item-row">
                    <span class="request-identity"><strong>${
                  escapeHtml(
                      request.passenger?.name ||
                      request
                          .passengerEmail)}</strong> <span class="request-divider">-</span> <span class="meta">${
                  escapeHtml(
                      request
                          .passengerEmail)}</span> <span class="request-divider">-</span> <span class="pill status-${
                  request.status}">${escapeHtml(request.status)}</span></span>
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
                      request.status === 'accepted' ?
                      `
                        <div class="actions">
                          <button type="button" class="remove-passenger-button button-secondary" data-request-id="${
                          request.id}">Remove</button>
                        </div>
                      ` :
                      ''}
                  </div>
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
  const currentRequest = getCurrentUserRequest(ride);

  return `
    <article class="ride-card" data-ride-id="${ride.id}">
      <div>
        <div class="route">${escapeHtml(formatRideRouteLabel(ride))}</div>
        <div class="meta">Driver: ${
      escapeHtml(ride.driver?.name || ride.driverEmail)}</div>
      </div>

      <div class="card-grid">
        <div class="ride-window-field">
          <strong>Window</strong>
          <div class="meta ride-window-meta">${
      formatDateTimeRange(ride.startWindowStart, ride.startWindowEnd)}</div>
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

      <div class="actions ride-card-actions">
        <button type="button" class="button-secondary open-ride-details" data-ride-id="${
      ride.id}">See full ride details &#8663;</button>
      </div>

      ${renderRideSeatAction(ride, {allowRequest})}
    </article>
  `;
}

async function handleRideActions(container, refresh) {
  container.addEventListener('click', async (event) => {
    const rideCard = event.target.closest('[data-ride-id]');
    if (!rideCard) {
      return;
    }

    const rideDetailsButton = event.target.closest('.open-ride-details');
    if (rideDetailsButton) {
      await openRideDetailsModal(rideDetailsButton.dataset.rideId, refresh);
      return;
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
        showToast(`Request ${event.target.dataset.decision}.`);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const leaveRideButton = event.target.closest('.leave-ride-button');
    if (leaveRideButton) {
      try {
        await leaveRide(leaveRideButton.dataset.requestId, refresh);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
  });

  container.addEventListener('submit', async (event) => {
    const requestForm = event.target.closest('[data-request-ride-id]');
    if (requestForm) {
      event.preventDefault();
      const rideId = requestForm.dataset.requestRideId;

      try {
        await requestSeatForRide(rideId, refresh);
      } catch (error) {
        showToast(error.message, 'error');
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
      showToast('Write a message before sending.', 'error');
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
      showToast('Message sent.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function ensureAuthenticated() {
  if (!state.currentUser) {
    redirectTo('login.html');
    return false;
  }

  wireLogout();
  return true;
}

function ensureManager() {
  if (!userIsManager()) {
    redirectTo('index.html');
    return false;
  }

  return true;
}

async function setupLandingPage() {
  syncLandingPageAuthState();

  const scrollIndicator = document.querySelector('.scroll-indicator');
  const marketingHero = document.querySelector('.marketing-hero');
  if (scrollIndicator || marketingHero) {
    const fadeDistance = 220;
    const mobileBreakpoint = 760;
    const syncScrollIndicator = () => {
      const isMobile = window.innerWidth <= mobileBreakpoint;
      const progress = Math.min(1, window.scrollY / fadeDistance);
      if (scrollIndicator) scrollIndicator.style.opacity = 1 - progress;
      if (marketingHero) {
        marketingHero.style.opacity = isMobile ? progress : '';
      }
    };
    window.addEventListener('scroll', syncScrollIndicator, {passive: true});
    syncScrollIndicator();
  }
}

async function setupSignupPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('index.html');
    return;
  }

  const officeSelect = document.querySelector('select[name="defaultOffice"]');
  const passwordInput = document.querySelector('input[name="password"]');
  const {displayInput: defaultStartingLocationInput} =
      getLocationFieldElements('defaultStartingLocation');
  if (defaultStartingLocationInput) {
    defaultStartingLocationInput.dataset.locationField =
        'defaultStartingLocation';
  }
  syncSelectPlaceholderState(officeSelect);
  officeSelect?.addEventListener('change', () => {
    syncSelectPlaceholderState(officeSelect);
  });
  initializeLocationAutocomplete(defaultStartingLocationInput);
  await setupLocationMapTriggers();

  passwordInput?.addEventListener('input', () => {
    if (!passwordInput.value || isStrongPassword(passwordInput.value)) {
      passwordInput.setCustomValidity('');
      return;
    }

    passwordInput.setCustomValidity(PASSWORD_REQUIREMENTS_MESSAGE);
  });

  document.querySelector('#signup-form')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const profile = Object.fromEntries(formData.entries());

        if (!isStrongPassword(profile.password)) {
          passwordInput?.setCustomValidity(PASSWORD_REQUIREMENTS_MESSAGE);
          passwordInput?.reportValidity();
          setFeedback(PASSWORD_REQUIREMENTS_MESSAGE, true);
          return;
        }

        passwordInput?.setCustomValidity('');

        try {
          const payload = await api('/api/auth/signup', {
            method: 'POST',
            body: JSON.stringify(profile),
          });

          state.currentUser = payload.profile;
          redirectTo('index.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupLoginPage() {
  await loadCurrentUser();
  if (state.currentUser) {
    redirectTo('index.html');
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
          redirectTo('index.html');
        } catch (error) {
          setFeedback(error.message, true);
        }
      });
}

async function setupDashboardPage() {
  const hubGrid = document.querySelector('.hub-grid');

  if (hubGrid && userIsManager()) {
    hubGrid.insertAdjacentHTML('beforeend', `
          <a href="debug.html" class="hub-card">
            <span class="hub-label">06</span>
            <h2>Debug data</h2>
            <p>Inspect all users, rides, requests, and ride chat data.</p>
          </a>
        `);
  }
}

function ensureLocationMapModal() {
  let modal = document.querySelector('#location-map-modal');
  if (modal) {
    return modal;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="location-map-modal" class="notes-modal" hidden>
      <div class="notes-modal-backdrop" data-close-location-map-modal="true"></div>
      <div class="notes-modal-panel location-map-modal-panel" role="dialog" aria-modal="true" aria-labelledby="location-map-modal-title">
        <div class="notes-modal-header">
          <h2 id="location-map-modal-title">Choose location</h2>
          <div class="location-map-close-buttons">
            <button type="button" class="button-secondary location-map-close-button-text" data-close-location-map-modal="true" aria-label="Close location picker">Close</button>
            <button type="button" class="button-secondary location-map-close-button-icon" data-close-location-map-modal="true" aria-label="Close location picker">&times;</button>
          </div>
        </div>
        <div class="location-map-modal-body">
          <div id="location-map-canvas" class="location-map-canvas" aria-label="Location map"></div>
          <div class="location-map-selection-card" aria-live="polite">
            <div class="location-map-selection-label">Selected location</div>
            <div id="location-map-selection-value" class="location-map-selection-value">No pin selected yet.</div>
          </div>
          <div class="location-map-actions">
            <button type="button" class="button-secondary location-map-cancel-button" data-close-location-map-modal="true">Cancel</button>
            <button type="button" id="confirm-location-map-button" disabled>Use this location</button>
          </div>
        </div>
      </div>
    </div>
  `);

  return document.querySelector('#location-map-modal');
}

async function setupLocationMapTriggers() {
  const openButtons =
      Array.from(document.querySelectorAll('[data-location-target]'));

  if (!openButtons.length) {
    return;
  }

  if (!window.mapboxgl) {
    setFeedback('Mapbox GL JS did not load.', true);
    return;
  }

  try {
    const config = await loadClientConfig();
    const token = String(config?.mapboxPublicToken || '').trim();

    if (!token) {
      setFeedback('Mapbox token is missing.', true);
      return;
    }

    window.mapboxgl.accessToken = token;

    const modal = ensureLocationMapModal();
    const mapContainer = modal.querySelector('#location-map-canvas');
    const title = modal.querySelector('#location-map-modal-title');
    const selectionValue = modal.querySelector('#location-map-selection-value');
    const confirmButton = modal.querySelector('#confirm-location-map-button');
    let map = null;
    let marker = null;
    let selectedLocation = null;
    let currentInput = null;
    let currentFieldLabel = 'location';
    let lookupController = null;

    const setSelectionText = (message, isError = false) => {
      selectionValue.textContent = message;
      selectionValue.classList.toggle('location-map-selection-error', isError);
    };

    const resetSelection = (message) => {
      selectedLocation = null;
      confirmButton.disabled = true;
      setSelectionText(message);
    };

    const ensureMarker = () => {
      if (marker) {
        return marker;
      }

      marker = new window.mapboxgl
                   .Marker({
                     color: '#09005d',
                     draggable: true,
                   })
                   .setLngLat(DEFAULT_LOCATION_MAP_CENTER)
                   .addTo(map);
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        selectLocationFromCoordinates(lngLat.lng, lngLat.lat, {
          shouldFlyTo: false,
        });
      });

      return marker;
    };

    const initializeMap = () => {
      if (map) {
        requestAnimationFrame(() => {
          map.resize();
        });
        return map;
      }

      map = new window.mapboxgl.Map({
        container: mapContainer,
        style: 'mapbox://styles/mapbox/standard',
        center: DEFAULT_LOCATION_MAP_CENTER,
        zoom: DEFAULT_LOCATION_MAP_ZOOM,
        pitch: 0,
        bearing: 0,
        projection: 'mercator',
        language: 'pt',
        config: {
          basemap: {
            lightPreset: 'day',
            show3dObjects: false,
            showPointOfInterestLabels: true,
          },
        },
      });

      map.addControl(
          new window.mapboxgl.NavigationControl({
            showCompass: false,
            visualizePitch: false,
          }),
          'top-right');

      map.on('click', (event) => {
        selectLocationFromCoordinates(event.lngLat.lng, event.lngLat.lat);
      });

      return map;
    };

    const selectLocationFromCoordinates =
        async (longitude, latitude, {shouldFlyTo = true} = {}) => {
      const activeMap = initializeMap();
      const activeMarker = ensureMarker();

      lookupController?.abort();
      const controller = new AbortController();
      lookupController = controller;

      activeMarker.setLngLat([longitude, latitude]);
      if (shouldFlyTo) {
        activeMap.flyTo({
          center: [longitude, latitude],
          zoom: Math.max(activeMap.getZoom(), 13),
          essential: true,
        });
      }

      confirmButton.disabled = true;
      setSelectionText('Resolving dropped pin...');

      try {
        const feature = await reverseGeocodeMapboxLocation(
            longitude, latitude, controller.signal);

        if (lookupController !== controller) {
          return;
        }

        selectedLocation = {
          label: feature?.place_name ||
              formatLocationCoordinates(longitude, latitude),
          longitude,
          latitude,
        };
        confirmButton.disabled = false;
        setSelectionText(selectedLocation.label);
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        selectedLocation = {
          label: formatLocationCoordinates(longitude, latitude),
          longitude,
          latitude,
        };
        confirmButton.disabled = false;
        setSelectionText(selectedLocation.label, true);
      }
    };

    const syncMapToInputValue = async (input) => {
      const fieldName = String(input?.dataset.locationField || '').trim();
      const form = input?.form || document;
      const {hiddenInput} = fieldName ?
          getLocationFieldElements(fieldName, form) :
          {hiddenInput: input};
      const query = String(hiddenInput?.value || input?.value || '').trim();
      const activeMap = initializeMap();

      lookupController?.abort();
      lookupController = null;

      if (!query) {
        selectedLocation = null;
        confirmButton.disabled = true;
        marker?.remove();
        marker = null;
        activeMap.flyTo({
          center: DEFAULT_LOCATION_MAP_CENTER,
          zoom: DEFAULT_LOCATION_MAP_ZOOM,
          essential: true,
        });
        setSelectionText('No pin selected yet.');
        return;
      }

      setSelectionText('Finding current location...');

      try {
        const feature = await fetchMapboxLocationFeature(query);
        const center = feature?.center;

        if (!feature || !Array.isArray(center) || center.length < 2) {
          marker?.remove();
          marker = null;
          resetSelection('Click on the map to drop a pin for this field.');
          activeMap.flyTo({
            center: DEFAULT_LOCATION_MAP_CENTER,
            zoom: DEFAULT_LOCATION_MAP_ZOOM,
            essential: true,
          });
          return;
        }

        selectedLocation = {
          label: feature.place_name || query,
          longitude: center[0],
          latitude: center[1],
        };
        ensureMarker().setLngLat(center);
        activeMap.flyTo({
          center,
          zoom: Math.max(activeMap.getZoom(), 13),
          essential: true,
        });
        confirmButton.disabled = false;
        setSelectionText(selectedLocation.label);
      } catch {
        marker?.remove();
        marker = null;
        resetSelection('Click on the map to drop a pin for this field.');
        activeMap.flyTo({
          center: DEFAULT_LOCATION_MAP_CENTER,
          zoom: DEFAULT_LOCATION_MAP_ZOOM,
          essential: true,
        });
      }
    };

    const openModal = () => {
      title.textContent = `Choose ${currentFieldLabel}`;
      modal.hidden = false;
      initializeMap();
      requestAnimationFrame(() => {
        map?.resize();
      });
      syncMapToInputValue(currentInput);
    };

    const closeModal = () => {
      modal.hidden = true;
    };

    openButtons.forEach((openButton) => {
      openButton.addEventListener('click', () => {
        const targetName = openButton.dataset.locationTarget;
        const label =
            String(openButton.dataset.locationLabel || 'location').trim();
        const form = openButton.closest('form');
        const {displayInput: input} =
            getLocationFieldElements(targetName, form || document);

        if (!input) {
          setFeedback('Unable to connect the map picker to that field.', true);
          return;
        }

        currentInput = input;
        currentFieldLabel = label;
        openModal();
      });
    });

    confirmButton.addEventListener('click', () => {
      if (!currentInput || !selectedLocation?.label) {
        return;
      }

      const form = currentInput.form || document;
      const fieldName = currentInput.dataset.locationField;
      if (fieldName) {
        setLocationFieldValue(fieldName, selectedLocation.label, form);
      } else {
        currentInput.value = selectedLocation.label;
      }
      currentInput.dispatchEvent(new Event('change', {bubbles: true}));
      closeModal();
    });

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-location-map-modal="true"]')) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) {
        closeModal();
      }
    });

    window.addEventListener('resize', () => {
      if (map && !modal.hidden) {
        map.resize();
      }
    });
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function setupFindUsersPage() {
  const form = document.querySelector('#find-users-form');
  const searchInput = form.querySelector('input[name="query"]');
  const resultsContainer = document.querySelector('#users-results');
  const resetButton = document.querySelector('#reset-user-search');
  let activeRequestController = null;
  let lastRequestedQuery = '';

  const renderProfiles = (profiles, searchQuery = '') => {
    if (!profiles.length) {
      const message = searchQuery ?
          `No users found for "${escapeHtml(searchQuery)}".` :
          'No users available right now.';
      resultsContainer.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }

    resultsContainer.innerHTML =
        profiles.map((profile) => renderUserSearchCard(profile)).join('');
  };

  const refresh = async (searchQuery = '', signal) => {
    const profiles = await loadProfiles(searchQuery, {signal});
    renderProfiles(profiles, searchQuery);
  };

  const runSearch = async (searchQuery, {force = false} = {}) => {
    if (!force && searchQuery === lastRequestedQuery) {
      return;
    }

    if (activeRequestController) {
      activeRequestController.abort();
    }

    lastRequestedQuery = searchQuery;
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      await refresh(searchQuery, requestController.signal);
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (activeRequestController === requestController) {
        lastRequestedQuery = '';
        setFeedback(error.message, true);
      }
    } finally {
      if (activeRequestController === requestController) {
        activeRequestController = null;
      }
    }
  };

  const scheduleSearch = debounce(() => {
    runSearch(searchInput.value.trim());
  }, 350);

  await runSearch('', {force: true});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    scheduleSearch.cancel();
    await runSearch(searchInput.value.trim(), {force: true});
  });

  searchInput.addEventListener('input', () => {
    scheduleSearch();
  });

  searchInput.addEventListener('change', async () => {
    scheduleSearch.cancel();
    await runSearch(searchInput.value.trim());
  });

  resetButton.addEventListener('click', async () => {
    scheduleSearch.cancel();
    searchInput.value = '';
    lastRequestedQuery = '';
    await runSearch('', {force: true});
  });
}

async function setupCreateRidePage() {
  const form = document.querySelector('#ride-form');
  const carInput = form.querySelector('input[name="car"]');
  const {displayInput: startPointInput} =
      getLocationFieldElements('startPoint', form);
  const {displayInput: endPointInput} =
      getLocationFieldElements('endPoint', form);
  const officePickerButton =
      document.querySelector('#toggle-office-picker-button');
  const officePickerPanel = document.querySelector('#office-picker-panel');
  const closeOfficePickerButton =
      document.querySelector('#close-office-picker-button');
  const officePickerOptions = officePickerPanel ?
      Array.from(officePickerPanel.querySelectorAll('[data-office-location]')) :
      [];
  const dateInput = form.querySelector('input[name="rideDate"]');
  const startTimeInput = form.querySelector('input[name="startTime"]');
  const endTimeInput = form.querySelector('input[name="endTime"]');
  const swapRouteButton = document.querySelector('#swap-route-button');
  const today = new Date();
  const nextMinute = roundUpToNextMinute(today);

  dateInput.min = formatDateForInput(today);
  dateInput.value = formatDateForInput(today);
  startTimeInput.value = formatTimeForInput(nextMinute);
  endTimeInput.value = addMinutesToTime(startTimeInput.value, 60);

  if (!carInput.value) {
    carInput.value = state.currentUser.defaultCar || '';
  }

  if (startPointInput) {
    startPointInput.dataset.locationField = 'startPoint';
  }

  if (endPointInput) {
    endPointInput.dataset.locationField = 'endPoint';
  }

  applyUserRouteDefaults(form);
  initializeLocationAutocomplete(startPointInput);
  initializeLocationAutocomplete(endPointInput);
  await setupLocationMapTriggers();

  const closeOfficePicker = () => {
    if (!officePickerButton || !officePickerPanel) {
      return;
    }

    officePickerPanel.hidden = true;
    officePickerButton.setAttribute('aria-expanded', 'false');
  };

  const openOfficePicker = () => {
    if (!officePickerButton || !officePickerPanel) {
      return;
    }

    officePickerPanel.hidden = false;
    officePickerButton.setAttribute('aria-expanded', 'true');
  };

  const syncOfficePickerSelection = () => {
    const {hiddenInput} = getLocationFieldElements('endPoint', form);
    const selectedOffice = getOfficeLocationByAddress(hiddenInput?.value || '');

    officePickerOptions.forEach((option) => {
      const isActive = option.dataset.officeLocation === selectedOffice;
      option.classList.toggle('office-picker-option-active', isActive);
      option.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const applyOfficeSelection = (officeLocation) => {
    setLocationFieldValue('endPoint', getOfficeAddress(officeLocation), form, {
      displayValue: formatOfficeLocation(officeLocation),
    });
    syncOfficePickerSelection();
  };

  if (officePickerButton && officePickerPanel) {
    syncOfficePickerSelection();

    officePickerButton.addEventListener('click', () => {
      if (officePickerPanel.hidden) {
        openOfficePicker();
        return;
      }

      closeOfficePicker();
    });

    officePickerOptions.forEach((option) => {
      option.addEventListener('click', () => {
        applyOfficeSelection(option.dataset.officeLocation || '');
        closeOfficePicker();
        endPointInput?.focus();
      });
    });

    closeOfficePickerButton?.addEventListener('click', () => {
      closeOfficePicker();
      officePickerButton.focus();
    });

    document.addEventListener('click', (event) => {
      if (officePickerPanel.hidden) {
        return;
      }

      if (event.target.closest('#office-picker-panel') ||
          event.target.closest('#toggle-office-picker-button')) {
        return;
      }

      closeOfficePicker();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !officePickerPanel.hidden) {
        closeOfficePicker();
      }
    });

    endPointInput?.addEventListener('input', syncOfficePickerSelection);
    endPointInput?.addEventListener('change', syncOfficePickerSelection);
  }

  syncRideTimeConstraints(dateInput, startTimeInput, endTimeInput);

  if (swapRouteButton) {
    swapRouteButton.addEventListener('click', () => {
      swapLocationFieldValues('startPoint', 'endPoint', form);
      syncOfficePickerSelection();
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

      openRideConfirmModal({
        ride,
        form,
        carInput,
        dateInput,
        startTimeInput,
        endTimeInput,
      });
    } catch (error) {
      setFeedback(error.message, true);
    }
  });
}

async function setupSearchRidesPage() {
  const ridesList = document.querySelector('#rides-list');
  const searchForm = document.querySelector('#search-form');
  const resetButton = document.querySelector('#reset-search');
  const driverInput = searchForm.querySelector('input[name="driver"]');
  const startInput = searchForm.querySelector('input[name="start"]');
  const endInput = searchForm.querySelector('input[name="end"]');
  const openOnlyInput = searchForm.querySelector('input[name="openOnly"]');
  let activeRequestController = null;
  let lastRequestedFilterKey = '';

  const readFilters = () => {
    const formData = new FormData(searchForm);

    return {
      driver: String(formData.get('driver') || '').trim(),
      start: String(formData.get('start') || '').trim(),
      end: String(formData.get('end') || '').trim(),
      openOnly: formData.get('openOnly') === 'on',
    };
  };

  const refresh = async (signal) => {
    const rides = await loadRides(state.filters, {signal});
    ridesList.innerHTML = rides.length ?
        rides.map((ride) => renderRideCard(ride)).join('') :
        '<div class="empty-state">No rides found. Try adjusting the filters.</div>';
  };

  const runSearch = async (nextFilters, {force = false} = {}) => {
    const nextFilterKey = JSON.stringify(nextFilters);
    if (!force && nextFilterKey === lastRequestedFilterKey) {
      return;
    }

    if (activeRequestController) {
      activeRequestController.abort();
    }

    state.filters = nextFilters;
    lastRequestedFilterKey = nextFilterKey;
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      await refresh(requestController.signal);
      if (activeRequestController !== requestController) {
        return;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      if (activeRequestController === requestController) {
        lastRequestedFilterKey = '';
        setFeedback(error.message, true);
      }
    } finally {
      if (activeRequestController === requestController) {
        activeRequestController = null;
      }
    }
  };

  const scheduleSearch = debounce(() => {
    runSearch(readFilters());
  }, 350);

  await runSearch(state.filters, {force: true});
  await handleRideActions(ridesList, refresh);

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    scheduleSearch.cancel();
    await runSearch(readFilters(), {force: true});
  });

  [driverInput, startInput, endInput].forEach((input) => {
    input.addEventListener('input', () => {
      scheduleSearch();
    });

    input.addEventListener('change', () => {
      scheduleSearch.cancel();
      runSearch(readFilters());
    });
  });

  openOnlyInput.addEventListener('change', async () => {
    scheduleSearch.cancel();
    await runSearch(readFilters());
  });

  resetButton.addEventListener('click', async () => {
    scheduleSearch.cancel();
    searchForm.reset();
    lastRequestedFilterKey = '';
    await runSearch(
        {driver: '', start: '', end: '', openOnly: false}, {force: true});
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
            (request) => request.passengerId === state.currentUser.id &&
                ['pending', 'accepted'].includes(request.status)));

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
          <strong>Default starting location</strong>
          <div class="meta">${
      escapeHtml(profile.defaultStartingLocation || '—')}</div>
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
                    <strong>${escapeHtml(formatRideRouteLabel(ride))}</strong>
                    <span class="meta">${
                          formatDateTimeRange(
                              ride.startWindowStart,
                              ride.startWindowEnd,
                              )} · Seats ${ride.seatsLeft}/${
                          ride.seatsTotal}</span>
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
                    <strong>${escapeHtml(formatRideRouteLabel(ride))}</strong>
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
          <h3>${escapeHtml(formatRideRouteLabel(ride))}</h3>
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
          <div class="meta">${
      formatDateTimeRange(ride.startWindowStart, ride.startWindowEnd)}</div>
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
      } catch (error) {
        setFeedback(error.message, true);
      }
    });
  }
}

async function setupProfilePage() {
  const form = document.querySelector('#profile-update-form');
  const deleteAccountButton = document.querySelector('#delete-account-button');
  const {displayInput: defaultStartingLocationInput} =
      getLocationFieldElements('defaultStartingLocation', form);
  form.elements.name.value = state.currentUser.name || '';
  form.elements.email.value = state.currentUser.email || '';
  form.elements.phone.value = state.currentUser.phone || '';
  form.elements.defaultCar.value = state.currentUser.defaultCar || '';
  form.elements.defaultOffice.value = state.currentUser.defaultOffice || '';
  if (defaultStartingLocationInput) {
    defaultStartingLocationInput.dataset.locationField =
        'defaultStartingLocation';
  }
  setLocationFieldValue(
      'defaultStartingLocation',
      state.currentUser.defaultStartingLocation || '', form);
  initializeLocationAutocomplete(defaultStartingLocationInput);

  syncSelectPlaceholderState(form.elements.defaultOffice);
  form.elements.defaultOffice.addEventListener('change', () => {
    syncSelectPlaceholderState(form.elements.defaultOffice);
  });

  await setupLocationMapTriggers();

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
      setPendingToast('Profile updated successfully.');
      redirectTo(consumeReturnPath(PROFILE_RETURN_PATH_KEY, 'dashboard.html'));
    } catch (error) {
      setFeedback(error.message, true);
    }
  });

  deleteAccountButton?.addEventListener('click', async () => {
    openDeleteAccountModal();
  });
}

// --- Direct Messaging ---

async function fetchUnreadCount() {
  try {
    const payload = await api('/api/dm/unread-count');
    return payload.count;
  } catch {
    return 0;
  }
}

function updateUnreadBadges(count) {
  document.querySelectorAll('.nav-unread-badge').forEach((badge) => {
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  });
}

async function refreshUnreadBadges() {
  if (!state.currentUser) return;
  const count = await fetchUnreadCount();
  updateUnreadBadges(count);
}

function formatDmTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
  if (isYesterday) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], {month: 'short', day: 'numeric'});
}

function renderConversationItem(conversation, activeUserId) {
  const user = conversation.user;
  const lastMsg = conversation.lastMessage;
  const isActive = user.id === activeUserId;
  const unreadClass =
      conversation.unreadCount > 0 ? ' dm-conversation-item-unread' : '';
  const activeClass = isActive ? ' dm-conversation-item-active' : '';
  const preview = lastMsg ? escapeHtml(lastMsg.text).slice(0, 60) : '';
  const time = lastMsg ? formatDmTime(lastMsg.createdAt) : '';

  return `
    <button type="button" class="dm-conversation-item${unreadClass}${
      activeClass}" data-dm-user-id="${escapeHtml(user.id)}">
      <img src="images/icon_default_user.svg" alt="" class="dm-avatar" />
      <div class="dm-conversation-item-body">
        <div class="dm-conversation-item-header">
          <strong class="dm-conversation-item-name">${
      escapeHtml(user.name || 'Unnamed user')}</strong>
          <span class="dm-conversation-item-time">${time}</span>
        </div>
        <div class="dm-conversation-item-preview">${preview}</div>
      </div>
      ${
      conversation.unreadCount > 0 ?
          `<span class="dm-conversation-item-badge">${
              conversation.unreadCount > 99 ?
                  '99+' :
                  conversation.unreadCount}</span>` :
          ''}
    </button>
  `;
}

function renderDmMessage(dm, currentUserId) {
  const isMine = dm.senderId === currentUserId;
  const sideClass = isMine ? 'dm-bubble-mine' : 'dm-bubble-theirs';

  return `
    <div class="dm-bubble ${sideClass}">
      <div class="dm-bubble-text">${escapeHtml(dm.text)}</div>
      <div class="dm-bubble-time">${formatDmTime(dm.createdAt)}</div>
    </div>
  `;
}

async function setupMessagesPage() {
  const sidebar = document.querySelector('#dm-sidebar');
  const conversationList = document.querySelector('#dm-conversation-list');
  const chatArea = document.querySelector('#dm-chat');
  let activeConversationUserId = null;
  let conversations = [];

  // Check URL for ?user=... to open a specific conversation
  const urlParams = new URLSearchParams(window.location.search);
  const targetUserId = urlParams.get('user');

  // Connect socket for real-time
  const socket = typeof io !== 'undefined' ? io() : null;

  function renderConversationList() {
    if (!conversations.length) {
      conversationList.innerHTML =
          '<div class="empty-state">No conversations yet.</div>';
      return;
    }
    conversationList.innerHTML =
        conversations
            .map((c) => renderConversationItem(c, activeConversationUserId))
            .join('');
  }

  function renderChatView(messages, otherUser) {
    const messagesHtml = messages.length ?
        messages.map((m) => renderDmMessage(m, state.currentUser.id)).join('') :
        '<div class="empty-state">No messages yet. Say hello!</div>';

    chatArea.innerHTML = `
      <div class="dm-chat-header">
        <button type="button" class="dm-back-button" id="dm-back-button" aria-label="Back to conversations">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <div class="dm-chat-header-info">
          <img src="images/icon_default_user.svg" alt="" class="dm-avatar" />
          <strong>${escapeHtml(otherUser.name || 'Unnamed user')}</strong>
          <span class="meta">${escapeHtml(otherUser.publicId || '')}</span>
        </div>
      </div>
      <div class="dm-messages" id="dm-messages">${messagesHtml}</div>
      <form class="dm-compose" id="dm-compose">
        <input type="text" name="text" placeholder="Type a message..." autocomplete="off" />
        <button type="submit" aria-label="Send message">
          <img src="images/icon_send_message.svg" alt="" width="22" height="22" style="margin-left: 3px" />
        </button>
      </form>
    `;

    const messagesContainer = chatArea.querySelector('#dm-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Wire back button
    chatArea.querySelector('#dm-back-button').addEventListener('click', () => {
      activeConversationUserId = null;
      sidebar.classList.remove('dm-sidebar-hidden');
      chatArea.classList.remove('dm-chat-active');
      renderConversationList();
      // Clean URL
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    });

    // Wire compose form
    const composeForm = chatArea.querySelector('#dm-compose');
    const composeInput = composeForm.querySelector('input[name="text"]');

    composeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = composeInput.value.trim();
      if (!text) return;

      composeInput.value = '';

      try {
        await api(`/api/dm/conversations/${activeConversationUserId}`, {
          method: 'POST',
          body: JSON.stringify({text}),
        });
      } catch (error) {
        showToast(error.message, 'error');
        composeInput.value = text;
      }
    });

    composeInput.addEventListener('focus', async () => {
      const conv =
          conversations.find((c) => c.userId === activeConversationUserId);
      if (conv && conv.unreadCount > 0) {
        conv.unreadCount = 0;
        renderConversationList();
        await api(
            `/api/dm/conversations/${activeConversationUserId}/read`,
            {method: 'POST'});
        refreshUnreadBadges();
      }
    });

    composeInput.focus();
  }

  async function openConversation(userId) {
    activeConversationUserId = userId;
    sidebar.classList.add('dm-sidebar-hidden');
    chatArea.classList.add('dm-chat-active');
    chatArea.innerHTML =
        '<div class="dm-chat-placeholder"><p class="meta">Loading messages...</p></div>';

    try {
      const payload = await api(`/api/dm/conversations/${userId}`);
      const conv = conversations.find((c) => c.userId === userId);
      const otherUser = conv ? conv.user : {id: userId, name: 'User'};

      renderChatView(payload.messages, otherUser);

      // Mark as read
      if (conv && conv.unreadCount > 0) {
        conv.unreadCount = 0;
        renderConversationList();
        await api(`/api/dm/conversations/${userId}/read`, {method: 'POST'});
        refreshUnreadBadges();
      }
    } catch (error) {
      chatArea.innerHTML = `<div class="dm-chat-placeholder"><p class="meta">${
          escapeHtml(error.message)}</p></div>`;
    }
  }

  async function loadConversations() {
    try {
      const payload = await api('/api/dm/conversations');
      conversations = payload.conversations;
      renderConversationList();
    } catch (error) {
      conversationList.innerHTML =
          `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  // Click on conversation item
  conversationList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-dm-user-id]');
    if (!item) return;
    openConversation(item.dataset.dmUserId);
  });

  // Socket.io real-time incoming messages
  if (socket) {
    socket.on('dm:new', (dm) => {
      const otherUserId =
          dm.senderId === state.currentUser.id ? dm.receiverId : dm.senderId;

      // Update conversation list
      const existingConv = conversations.find((c) => c.userId === otherUserId);
      if (existingConv) {
        existingConv.lastMessage = dm;
        if (dm.receiverId === state.currentUser.id &&
            otherUserId !== activeConversationUserId) {
          existingConv.unreadCount += 1;
        }
        // Move to top
        conversations =
            [existingConv, ...conversations.filter((c) => c !== existingConv)];
      } else {
        const otherUser =
            dm.senderId === state.currentUser.id ? dm.receiver : dm.sender;
        conversations.unshift({
          userId: otherUserId,
          user: otherUser,
          lastMessage: dm,
          unreadCount: dm.receiverId === state.currentUser.id ? 1 : 0,
        });
      }
      renderConversationList();

      // If this conversation is active, append the message
      if (otherUserId === activeConversationUserId) {
        const messagesContainer = chatArea.querySelector('#dm-messages');
        if (messagesContainer) {
          // Remove empty state if present
          const emptyState = messagesContainer.querySelector('.empty-state');
          if (emptyState) emptyState.remove();

          messagesContainer.insertAdjacentHTML(
              'beforeend', renderDmMessage(dm, state.currentUser.id));
          messagesContainer.scrollTop = messagesContainer.scrollHeight;

          // Mark as read if received
          if (dm.receiverId === state.currentUser.id) {
            const conv = conversations.find((c) => c.userId === otherUserId);
            if (conv) conv.unreadCount = 0;
            renderConversationList();
            api(`/api/dm/conversations/${otherUserId}/read`, {method: 'POST'});
          }
        }
      }

      refreshUnreadBadges();
    });

    socket.on('dm:read', ({otherUserId}) => {
      const conv = conversations.find((c) => c.userId === otherUserId);
      if (conv) {
        conv.unreadCount = 0;
        renderConversationList();
      }
    });
  }

  // Initial load
  await loadConversations();

  // If we have a target user, open or create that conversation
  if (targetUserId) {
    const existingConv = conversations.find((c) => c.userId === targetUserId);
    if (existingConv) {
      openConversation(targetUserId);
    } else {
      // User might not have a conversation yet, try to load their profile
      try {
        const profiles = await loadProfiles('', {});
        const targetUser =
            (state.profiles || []).find((p) => p.id === targetUserId);
        if (targetUser) {
          conversations.unshift({
            userId: targetUser.id,
            user: targetUser,
            lastMessage: null,
            unreadCount: 0,
          });
          renderConversationList();
        }
        openConversation(targetUserId);
      } catch {
        openConversation(targetUserId);
      }
    }
  }

  // Poll conversations and active chat every 20 seconds
  setInterval(async () => {
    await loadConversations();
    if (activeConversationUserId) {
      try {
        const payload =
            await api(`/api/dm/conversations/${activeConversationUserId}`);
        const messagesContainer = chatArea.querySelector('#dm-messages');
        if (messagesContainer) {
          const wasAtBottom = messagesContainer.scrollHeight -
                  messagesContainer.scrollTop - messagesContainer.clientHeight <
              40;
          messagesContainer.innerHTML = payload.messages.length ?
              payload.messages
                  .map((m) => renderDmMessage(m, state.currentUser.id))
                  .join('') :
              '<div class="empty-state">No messages yet. Say hello!</div>';
          if (wasAtBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }
      } catch { /* ignore polling errors */
      }
    }
  }, 20000);
}

async function init() {
  await loadCurrentUser();
  setupMobileMenus();

  if (protectedPages.has(page) && !ensureAuthenticated()) {
    return;
  }

  if (page === 'debug' && !ensureManager()) {
    return;
  }

  wireReturnPathLinks();
  showPendingToastIfPresent();

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
    case 'find-users':
      await setupFindUsersPage();
      break;
    case 'messages':
      await setupMessagesPage();
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

  // Poll unread badge count periodically for all authenticated pages
  if (state.currentUser) {
    refreshUnreadBadges();
    setInterval(refreshUnreadBadges, 20000);
  }
}

init().catch((error) => {
  setFeedback(error.message, true);
});
