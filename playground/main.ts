import {
  getAvailableProviders,
  getProvider,
  ContentProvider,
  ContentFolder,
  ContentItem,
  ContentProviderAuthData,
  DeviceAuthorizationResponse,
  isContentFolder,
  isContentFile,
  Plan,
  PlanPresentation,
} from "../src";

// Constants
const OAUTH_REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;
const STORAGE_KEY_VERIFIER = 'oauth_code_verifier';
const STORAGE_KEY_PROVIDER = 'oauth_provider_id';

// State management
interface AppState {
  currentView: 'providers' | 'browser' | 'plan';
  currentProvider: ContentProvider | null;
  currentAuth: ContentProviderAuthData | null;
  folderStack: ContentFolder[];
  connectedProviders: Map<string, ContentProviderAuthData | null>;
  // Device flow state
  deviceFlowActive: boolean;
  deviceFlowData: DeviceAuthorizationResponse | null;
  pollingInterval: number | null;
  slowDownCount: number;
  // Plan view state
  currentPlan: Plan | null;
  currentVenueFolder: ContentFolder | null;
}

const state: AppState = {
  currentView: 'providers',
  currentProvider: null,
  currentAuth: null,
  folderStack: [],
  connectedProviders: new Map(),
  deviceFlowActive: false,
  deviceFlowData: null,
  pollingInterval: null,
  slowDownCount: 0,
  currentPlan: null,
  currentVenueFolder: null,
};

// DOM Elements
const providersView = document.getElementById('providers-view')!;
const browserView = document.getElementById('browser-view')!;
const providersGrid = document.getElementById('providers-grid')!;
const contentGrid = document.getElementById('content-grid')!;
const breadcrumb = document.getElementById('breadcrumb')!;
const breadcrumbPath = document.getElementById('breadcrumb-path')!;
const backBtn = document.getElementById('back-btn')!;
const browserTitle = document.getElementById('browser-title')!;
const loadingEl = document.getElementById('loading')!;
const emptyEl = document.getElementById('empty')!;
const statusEl = document.getElementById('status')!;

// Modal elements
const modal = document.getElementById('device-flow-modal')!;
const modalTitle = document.getElementById('modal-title')!;
const modalClose = document.getElementById('modal-close')!;
const modalLoading = document.getElementById('device-flow-loading')!;
const modalCode = document.getElementById('device-flow-code')!;
const modalSuccess = document.getElementById('device-flow-success')!;
const modalError = document.getElementById('device-flow-error')!;
const verificationUrl = document.getElementById('verification-url')! as HTMLAnchorElement;
const userCode = document.getElementById('user-code')!;
const copyCodeBtn = document.getElementById('copy-code-btn')!;
const qrCode = document.getElementById('qr-code')! as HTMLImageElement;
const errorMessage = document.getElementById('error-message')!;
const retryBtn = document.getElementById('retry-btn')!;

// OAuth elements
const oauthSection = document.getElementById('oauth-flow-section')!;
const oauthSigninBtn = document.getElementById('oauth-signin-btn')!;
const oauthProcessing = document.getElementById('oauth-processing')!;


// Initialize
function init() {
  // Check for OAuth callback first
  handleOAuthCallback();

  renderProviders();
  setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
  backBtn.addEventListener('click', handleBack);
  modalClose.addEventListener('click', closeModal);
  copyCodeBtn.addEventListener('click', copyUserCode);
  retryBtn.addEventListener('click', retryAuth);
  oauthSigninBtn.addEventListener('click', startOAuthRedirect);

  // Close modal on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

// Render provider grid
function renderProviders() {
  const providers = getAvailableProviders();

  providersGrid.innerHTML = providers.map(provider => {
    const isConnected = state.connectedProviders.has(provider.id);
    const disabledClass = provider.implemented ? '' : 'disabled';

    let badges = '';
    if (!provider.implemented) {
      badges += '<span class="provider-badge badge-coming-soon">Coming Soon</span>';
    } else if (!provider.requiresAuth) {
      badges += '<span class="provider-badge badge-public">Public API</span>';
    } else {
      badges += '<span class="provider-badge badge-auth">Auth Required</span>';
    }
    if (provider.authTypes.includes('device_flow')) {
      badges += '<span class="provider-badge badge-device">Device Flow</span>';
    }

    let subtitle = 'Click to connect';
    if (!provider.implemented) {
      subtitle = 'Not yet available';
    } else if (isConnected) {
      subtitle = '✓ Connected';
    }

    const logoHtml = provider.logos.dark
      ? `<img class="card-image provider-logo" src="${provider.logos.dark}" alt="${provider.name}" onerror="this.outerHTML='<div class=\\'card-image placeholder\\'>📦</div>'">`
      : '<div class="card-image placeholder">📦</div>';

    return `
      <div class="card provider-card ${disabledClass}" data-provider-id="${provider.id}" data-implemented="${provider.implemented}">
        ${logoHtml}
        <h3 class="card-title">${provider.name}</h3>
        <p class="card-subtitle">${subtitle}</p>
        <div>${badges}</div>
      </div>
    `;
  }).join('');

  // Add click handlers (only for implemented providers)
  providersGrid.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
      const implemented = card.getAttribute('data-implemented') === 'true';
      if (!implemented) {
        showStatus('This provider is coming soon!', 'error');
        return;
      }
      const providerId = card.getAttribute('data-provider-id')!;
      handleProviderClick(providerId);
    });
  });
}

// Handle provider click
async function handleProviderClick(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) {
    showStatus('Provider not found', 'error');
    return;
  }

  state.currentProvider = provider;

  // Check if already connected
  if (state.connectedProviders.has(providerId)) {
    state.currentAuth = state.connectedProviders.get(providerId) || null;
    await navigateToBrowser();
    return;
  }

  // Check if auth is needed
  if (provider.requiresAuth()) {
    // Check if Device Flow is supported - prefer it for better UX
    if (provider.supportsDeviceFlow()) {
      await startDeviceFlow();
    } else {
      // Use OAuth PKCE flow
      showOAuthModal();
    }
    return;
  }

  // No auth needed - connect directly
  state.connectedProviders.set(providerId, null);
  state.currentAuth = null;

  // Navigate to browser
  await navigateToBrowser();
}

// ============= OAUTH PKCE FLOW =============

function showOAuthModal() {
  if (!state.currentProvider) return;

  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;
  showModal('oauth');
}

async function startOAuthRedirect() {
  if (!state.currentProvider) return;

  try {
    // Generate code verifier
    const codeVerifier = state.currentProvider.generateCodeVerifier();

    // Store verifier and provider ID for callback
    sessionStorage.setItem(STORAGE_KEY_VERIFIER, codeVerifier);
    sessionStorage.setItem(STORAGE_KEY_PROVIDER, state.currentProvider.id);

    // Build auth URL with localhost redirect
    const { url } = await state.currentProvider.buildAuthUrl(codeVerifier, OAUTH_REDIRECT_URI);

    // Redirect to OAuth provider
    window.location.href = url;
  } catch (error) {
    showModal('error');
    errorMessage.textContent = `Failed to start OAuth: ${error}`;
  }
}

async function handleOAuthCallback() {
  // Check for authorization code in URL
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state_param = urlParams.get('state');
  const error = urlParams.get('error');

  if (error) {
    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname);
    showStatus(`OAuth error: ${error}`, 'error');
    return;
  }

  if (!code) return;

  // Get stored verifier and provider
  const codeVerifier = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
  const providerId = sessionStorage.getItem(STORAGE_KEY_PROVIDER) || state_param;

  // Clear stored values
  sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
  sessionStorage.removeItem(STORAGE_KEY_PROVIDER);

  // Clear URL params
  window.history.replaceState({}, '', window.location.pathname);

  if (!codeVerifier || !providerId) {
    showStatus('OAuth callback error: missing verifier or provider', 'error');
    return;
  }

  const provider = getProvider(providerId);
  if (!provider) {
    showStatus('OAuth callback error: provider not found', 'error');
    return;
  }

  state.currentProvider = provider;

  // Show processing modal
  modalTitle.textContent = `Connecting to ${provider.name}`;
  showModal('processing');

  try {
    // Exchange code for tokens
    const authData = await provider.exchangeCodeForTokens(code, codeVerifier, OAUTH_REDIRECT_URI);

    if (!authData) {
      showModal('error');
      errorMessage.textContent = 'Failed to exchange authorization code for tokens.';
      return;
    }

    // Success!
    state.currentAuth = authData;
    state.connectedProviders.set(provider.id, authData);

    showModal('success');

    setTimeout(() => {
      closeModal();
      navigateToBrowser();
      renderProviders();
    }, 1500);

  } catch (error) {
    showModal('error');
    errorMessage.textContent = `Token exchange failed: ${error}`;
  }
}

// ============= DEVICE FLOW =============

async function startDeviceFlow() {
  if (!state.currentProvider) return;

  // Show modal in loading state
  showModal('loading');
  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;

  try {
    // Initiate device flow
    const deviceAuth = await state.currentProvider.initiateDeviceFlow();

    if (!deviceAuth) {
      showModal('error');
      errorMessage.textContent = 'Failed to initiate device authorization. Please try again.';
      return;
    }

    state.deviceFlowData = deviceAuth;
    state.deviceFlowActive = true;
    state.slowDownCount = 0;

    // Show code to user
    showModal('code');
    verificationUrl.href = deviceAuth.verification_uri_complete || deviceAuth.verification_uri;
    verificationUrl.textContent = deviceAuth.verification_uri;
    userCode.textContent = deviceAuth.user_code;

    // Generate QR code using a free API
    const qrUrl = deviceAuth.verification_uri_complete || `${deviceAuth.verification_uri}?user_code=${deviceAuth.user_code}`;
    qrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;

    // Start polling
    startPolling(deviceAuth);

  } catch (error) {
    showModal('error');
    errorMessage.textContent = `Error: ${error}`;
  }
}

function startPolling(deviceAuth: DeviceAuthorizationResponse) {
  if (!state.currentProvider) return;

  const baseInterval = deviceAuth.interval || 5;
  const expiresAt = Date.now() + (deviceAuth.expires_in * 1000);

  const poll = async () => {
    if (!state.deviceFlowActive || !state.currentProvider || !state.deviceFlowData) {
      return;
    }

    // Check expiration
    if (Date.now() > expiresAt) {
      state.deviceFlowActive = false;
      showModal('error');
      errorMessage.textContent = 'Authorization expired. Please try again.';
      return;
    }

    try {
      const result = await state.currentProvider.pollDeviceFlowToken(state.deviceFlowData.device_code);

      if (result === null) {
        // Failed - expired or denied
        state.deviceFlowActive = false;
        showModal('error');
        errorMessage.textContent = 'Authorization failed or was denied.';
        return;
      }

      if ('error' in result) {
        // Still pending or slow down
        if (result.shouldSlowDown) {
          state.slowDownCount++;
        }

        // Schedule next poll
        const delay = state.currentProvider.calculatePollDelay(baseInterval, state.slowDownCount);
        state.pollingInterval = window.setTimeout(poll, delay);
        return;
      }

      // Success! We have auth data
      state.deviceFlowActive = false;
      state.currentAuth = result;
      state.connectedProviders.set(state.currentProvider.id, result);

      // Show success briefly
      showModal('success');

      // Navigate to browser after a moment
      setTimeout(() => {
        closeModal();
        navigateToBrowser();
        renderProviders(); // Update connected status
      }, 1500);

    } catch (error) {
      console.error('Polling error:', error);
      // Continue polling on network errors
      const delay = state.currentProvider!.calculatePollDelay(baseInterval, state.slowDownCount);
      state.pollingInterval = window.setTimeout(poll, delay);
    }
  };

  // Start first poll after initial interval
  const initialDelay = state.currentProvider.calculatePollDelay(baseInterval, 0);
  state.pollingInterval = window.setTimeout(poll, initialDelay);
}

function showModal(view: 'loading' | 'code' | 'success' | 'error' | 'oauth' | 'processing') {
  modal.classList.remove('hidden');
  modalLoading.classList.add('hidden');
  modalCode.classList.add('hidden');
  modalSuccess.classList.add('hidden');
  modalError.classList.add('hidden');
  oauthSection.classList.add('hidden');
  oauthProcessing.classList.add('hidden');

  switch (view) {
    case 'loading':
      modalLoading.classList.remove('hidden');
      break;
    case 'code':
      modalCode.classList.remove('hidden');
      break;
    case 'success':
      modalSuccess.classList.remove('hidden');
      break;
    case 'error':
      modalError.classList.remove('hidden');
      break;
    case 'oauth':
      oauthSection.classList.remove('hidden');
      break;
    case 'processing':
      oauthProcessing.classList.remove('hidden');
      break;
  }
}

function closeModal() {
  modal.classList.add('hidden');
  state.deviceFlowActive = false;
  if (state.pollingInterval) {
    clearTimeout(state.pollingInterval);
    state.pollingInterval = null;
  }
}

function copyUserCode() {
  const code = userCode.textContent || '';
  navigator.clipboard.writeText(code).then(() => {
    showStatus('Code copied to clipboard!', 'success');
  }).catch(() => {
    showStatus('Failed to copy code', 'error');
  });
}

function retryAuth() {
  if (!state.currentProvider) {
    closeModal();
    return;
  }

  if (state.currentProvider.supportsDeviceFlow()) {
    startDeviceFlow();
  } else {
    showOAuthModal();
  }
}

// ============= NAVIGATION =============

// Navigate to content browser
async function navigateToBrowser() {
  state.currentView = 'browser';
  state.folderStack = [];

  providersView.classList.add('hidden');
  browserView.classList.remove('hidden');
  breadcrumb.classList.remove('hidden');

  updateBreadcrumb();
  await loadContent();
}

// Navigate back to providers
function navigateToProviders() {
  state.currentView = 'providers';
  state.currentProvider = null;
  state.folderStack = [];

  browserView.classList.add('hidden');
  breadcrumb.classList.add('hidden');
  providersView.classList.remove('hidden');

  renderProviders();
}

// Handle back button
function handleBack() {
  if (state.folderStack.length > 0) {
    state.folderStack.pop();
    updateBreadcrumb();
    loadContent();
  } else {
    navigateToProviders();
  }
}

// Update breadcrumb
function updateBreadcrumb() {
  const parts: string[] = [state.currentProvider?.name || 'Unknown'];
  state.folderStack.forEach(folder => {
    parts.push(folder.title);
  });

  breadcrumbPath.innerHTML = parts
    .map((part, i) => i === parts.length - 1 ? `<span>${part}</span>` : part)
    .join(' / ');

  browserTitle.textContent = state.folderStack.length > 0
    ? state.folderStack[state.folderStack.length - 1].title
    : state.currentProvider?.name || 'Content';
}

// ============= CONTENT LOADING =============

// Load content for current location
async function loadContent() {
  if (!state.currentProvider) return;

  showLoading(true);
  contentGrid.innerHTML = '';
  emptyEl.classList.add('hidden');

  try {
    let items: ContentItem[];

    if (state.folderStack.length === 0) {
      // Root level
      items = await state.currentProvider.getRootContents(state.currentAuth);
    } else {
      // Inside a folder
      const currentFolder = state.folderStack[state.folderStack.length - 1];
      items = await state.currentProvider.getFolderContents(currentFolder, state.currentAuth);
    }

    showLoading(false);

    if (items.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    renderContent(items);
  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load content: ${error}`, 'error');
  }
}

// Render content items
function renderContent(items: ContentItem[]) {
  contentGrid.innerHTML = items.map(item => {
    if (isContentFolder(item)) {
      return renderFolder(item);
    } else if (isContentFile(item)) {
      return renderFile(item);
    }
    return '';
  }).join('');

  // Add click handlers for folders
  contentGrid.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', () => {
      const folderId = card.getAttribute('data-folder-id')!;
      const folder = items.find(i => isContentFolder(i) && i.id === folderId) as ContentFolder;
      if (folder) {
        handleFolderClick(folder);
      }
    });
  });

  // Add click handlers for files
  contentGrid.querySelectorAll('.file-card').forEach(card => {
    card.addEventListener('click', () => {
      const fileId = card.getAttribute('data-file-id')!;
      const file = items.find(i => isContentFile(i) && i.id === fileId);
      if (file && isContentFile(file)) {
        handleFileClick(file);
      }
    });
  });
}

// Render a folder card
function renderFolder(folder: ContentFolder): string {
  const imageHtml = folder.image
    ? `<img class="card-image" src="${folder.image}" alt="${folder.title}" onerror="this.outerHTML='<div class=\\'card-image placeholder\\'>📁</div>'">`
    : '<div class="card-image placeholder">📁</div>';

  return `
    <div class="card content-card folder-card" data-folder-id="${folder.id}">
      ${imageHtml}
      <h3 class="card-title folder-icon">${folder.title}</h3>
      <p class="card-subtitle">Folder</p>
    </div>
  `;
}

// Render a file card
function renderFile(file: ContentItem & { type: 'file' }): string {
  const imageHtml = file.thumbnail
    ? `<img class="card-image" src="${file.thumbnail}" alt="${file.title}" onerror="this.outerHTML='<div class=\\'card-image placeholder\\'>${file.mediaType === 'video' ? '🎬' : '🖼️'}</div>'">`
    : `<div class="card-image placeholder">${file.mediaType === 'video' ? '🎬' : '🖼️'}</div>`;

  return `
    <div class="card content-card file-card" data-file-id="${file.id}">
      <div class="card-image-wrapper">
        ${imageHtml}
        <span class="media-badge ${file.mediaType}">${file.mediaType}</span>
      </div>
      <h3 class="card-title file-icon ${file.mediaType}">${file.title}</h3>
      <p class="card-subtitle">${file.mediaType === 'video' ? 'Video' : 'Image'}</p>
      <p class="file-url">${file.url}</p>
    </div>
  `;
}

// Handle folder click
function handleFolderClick(folder: ContentFolder) {
  // Check if this is a venue folder (has venueId in providerData)
  const isVenue = folder.providerData?.venueId || folder.providerData?.level === 'playlist';

  if (isVenue && state.currentProvider) {
    // Show choice modal for venue folders
    showVenueChoiceModal(folder);
  } else {
    // Normal folder navigation
    state.folderStack.push(folder);
    updateBreadcrumb();
    loadContent();
  }
}

// Show modal to choose between playlist and instructions view
function showVenueChoiceModal(folder: ContentFolder) {
  state.currentVenueFolder = folder;

  // Create and show a choice modal
  const choiceHtml = `
    <div class="venue-choice-modal" id="venue-choice-modal">
      <div class="venue-choice-content">
        <h2>Choose View for "${folder.title}"</h2>
        <p>How would you like to view this content?</p>
        <div class="venue-choice-buttons">
          <button id="view-playlist-btn" class="venue-btn playlist-btn">
            <span class="btn-icon">📋</span>
            <span class="btn-text">Playlist</span>
            <span class="btn-desc">Simple list of media files</span>
          </button>
          <button id="view-instructions-btn" class="venue-btn instructions-btn">
            <span class="btn-icon">📖</span>
            <span class="btn-text">Instructions</span>
            <span class="btn-desc">Structured sections with shows</span>
          </button>
        </div>
        <button id="venue-choice-cancel" class="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Add modal to page
  const existingModal = document.getElementById('venue-choice-modal');
  if (existingModal) existingModal.remove();

  document.body.insertAdjacentHTML('beforeend', choiceHtml);

  // Add event listeners
  document.getElementById('view-playlist-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsPlaylist(folder);
  });

  document.getElementById('view-instructions-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsInstructions(folder);
  });

  document.getElementById('venue-choice-cancel')!.addEventListener('click', closeVenueChoiceModal);

  // Close on backdrop click
  document.getElementById('venue-choice-modal')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'venue-choice-modal') {
      closeVenueChoiceModal();
    }
  });
}

function closeVenueChoiceModal() {
  const modal = document.getElementById('venue-choice-modal');
  if (modal) modal.remove();
  state.currentVenueFolder = null;
}

// View venue as simple playlist (existing behavior)
function viewAsPlaylist(folder: ContentFolder) {
  state.folderStack.push(folder);
  updateBreadcrumb();
  loadContent();
}

// View venue as structured instructions (plan view)
async function viewAsInstructions(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const plan = await state.currentProvider.getPlanContents(folder, state.currentAuth);

    if (!plan) {
      showStatus('This provider does not support instructions view', 'error');
      showLoading(false);
      return;
    }

    state.currentPlan = plan;
    state.currentVenueFolder = folder;
    state.currentView = 'plan';

    // Update breadcrumb to show we're in plan view
    state.folderStack.push(folder);
    updateBreadcrumb();

    showLoading(false);
    renderPlanView(plan);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load instructions: ${error}`, 'error');
  }
}

// Render the plan/instructions view
function renderPlanView(plan: Plan) {
  browserTitle.textContent = `${plan.name} (Instructions)`;

  let html = `
    <div class="plan-view">
      <div class="plan-header">
        ${plan.image ? `<img class="plan-image" src="${plan.image}" alt="${plan.name}">` : ''}
        <div class="plan-info">
          <h2>${plan.name}</h2>
          ${plan.description ? `<p class="plan-description">${plan.description}</p>` : ''}
          <p class="plan-stats">${plan.sections.length} sections • ${plan.allFiles.length} total files</p>
          <button id="play-all-btn" class="play-all-btn">▶ Play All (${plan.allFiles.length} files)</button>
        </div>
      </div>
      <div class="plan-sections">
  `;

  plan.sections.forEach((section, sectionIndex) => {
    html += `
      <div class="plan-section">
        <h3 class="section-title">${section.name}</h3>
        <div class="section-presentations">
    `;

    section.presentations.forEach((presentation, presentationIndex) => {
      const actionBadge = presentation.actionType === 'add-on'
        ? '<span class="action-badge addon">Add-on</span>'
        : '<span class="action-badge play">Play</span>';

      html += `
        <div class="presentation-card" data-section="${sectionIndex}" data-presentation="${presentationIndex}">
          <div class="presentation-info">
            <span class="presentation-name">${presentation.name}</span>
            ${actionBadge}
          </div>
          <div class="presentation-files">
            ${presentation.files.length} file${presentation.files.length !== 1 ? 's' : ''}
          </div>
          <button class="play-presentation-btn" data-section="${sectionIndex}" data-presentation="${presentationIndex}">▶ Play</button>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  contentGrid.innerHTML = html;
  emptyEl.classList.add('hidden');

  // Add event listeners
  document.getElementById('play-all-btn')?.addEventListener('click', () => {
    playPlanFiles(plan.allFiles);
  });

  contentGrid.querySelectorAll('.play-presentation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sectionIdx = parseInt((e.target as HTMLElement).getAttribute('data-section')!);
      const presentationIdx = parseInt((e.target as HTMLElement).getAttribute('data-presentation')!);
      const presentation = plan.sections[sectionIdx].presentations[presentationIdx];
      playPlanFiles(presentation.files);
    });
  });

  contentGrid.querySelectorAll('.presentation-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't trigger if clicking the play button
      if ((e.target as HTMLElement).classList.contains('play-presentation-btn')) return;

      const sectionIdx = parseInt(card.getAttribute('data-section')!);
      const presentationIdx = parseInt(card.getAttribute('data-presentation')!);
      const presentation = plan.sections[sectionIdx].presentations[presentationIdx];
      showPresentationDetails(presentation);
    });
  });
}

// Show details of a presentation (list its files)
function showPresentationDetails(presentation: PlanPresentation) {
  const filesHtml = presentation.files.map(file => `
    <div class="presentation-file-item">
      <span class="file-type ${file.mediaType}">${file.mediaType === 'video' ? '🎬' : '🖼️'}</span>
      <span class="file-title">${file.title || 'Untitled'}</span>
      <span class="file-seconds">${file.providerData?.seconds ? `${file.providerData.seconds}s` : ''}</span>
      <a href="${file.url}" target="_blank" class="file-link">Open</a>
    </div>
  `).join('');

  showStatus(`${presentation.name}: ${presentation.files.length} file(s)`, 'success');

  // Could expand this to show a modal with file details
  console.log('Presentation details:', presentation);
}

// Play files from plan
function playPlanFiles(files: ContentItem[]) {
  if (files.length === 0) {
    showStatus('No files to play', 'error');
    return;
  }

  // Open first file and log all files
  const firstFile = files[0];
  if (isContentFile(firstFile)) {
    window.open(firstFile.url, '_blank');
    showStatus(`Playing: ${firstFile.title} (${files.length} total files)`, 'success');
  }

  console.log('Playlist:', files);
}

// Handle file click
function handleFileClick(file: ContentItem & { type: 'file' }) {
  // Open the file URL in a new tab
  window.open(file.url, '_blank');
  showStatus(`Opening: ${file.title}`, 'success');
}

// ============= UI HELPERS =============

// Show/hide loading
function showLoading(show: boolean) {
  if (show) {
    loadingEl.classList.remove('hidden');
  } else {
    loadingEl.classList.add('hidden');
  }
}

// Show status message
function showStatus(message: string, type: 'success' | 'error' = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove('hidden');

  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 4000);
}

// Start the app
init();

// Log for debugging
console.log('Content Provider Helper Playground loaded');
console.log('Available providers:', getAvailableProviders());
console.log('OAuth redirect URI:', OAUTH_REDIRECT_URI);
