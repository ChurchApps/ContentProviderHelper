import { getAvailableProviders, getProvider, ContentProvider, ContentFolder, ContentItem, ContentProviderAuthData, DeviceAuthorizationResponse, isContentFolder, isContentFile, Plan, PlanPresentation, Instructions, InstructionItem, B1ChurchProvider, PlanningCenterProvider } from "../src";

const OAUTH_REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;
const STORAGE_KEY_VERIFIER = 'oauth_code_verifier';
const STORAGE_KEY_PROVIDER = 'oauth_provider_id';

// Configure client IDs for OAuth providers (using FreeShow's registered app credentials for testing)
const PCO_CLIENT_ID = '35d1112d839d678ce3f1de730d2cff0b81038c2944b11c5e2edf03f8b43abc05';
const B1_CLIENT_ID = 'nEgWOCjpj3p';
const B1_CLIENT_SECRET = 'raEFO2kT0Lc';

// Configure providers with client IDs
function configureProviders() {
  const pcoProvider = getProvider('planningcenter') as PlanningCenterProvider | null;
  if (pcoProvider) {
    (pcoProvider.config as any).clientId = PCO_CLIENT_ID;
  }

  const b1Provider = getProvider('b1church') as B1ChurchProvider | null;
  if (b1Provider) {
    (b1Provider.config as any).clientId = B1_CLIENT_ID;
  }
}

configureProviders();

interface AppState {
  currentView: 'providers' | 'browser' | 'plan' | 'instructions';
  currentProvider: ContentProvider | null;
  currentAuth: ContentProviderAuthData | null;
  folderStack: ContentFolder[];
  connectedProviders: Map<string, ContentProviderAuthData | null>;
  deviceFlowActive: boolean;
  deviceFlowData: DeviceAuthorizationResponse | null;
  pollingInterval: number | null;
  slowDownCount: number;
  currentPlan: Plan | null;
  currentInstructions: Instructions | null;
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
  currentInstructions: null,
  currentVenueFolder: null
};

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

const oauthSection = document.getElementById('oauth-flow-section')!;
const oauthSigninBtn = document.getElementById('oauth-signin-btn')!;
const oauthProcessing = document.getElementById('oauth-processing')!;

function init() {
  handleOAuthCallback();
  renderProviders();
  setupEventListeners();
}

function setupEventListeners() {
  backBtn.addEventListener('click', handleBack);
  modalClose.addEventListener('click', closeModal);
  copyCodeBtn.addEventListener('click', copyUserCode);
  retryBtn.addEventListener('click', retryAuth);
  oauthSigninBtn.addEventListener('click', startOAuthRedirect);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

function renderProviders() {
  const providers = getAvailableProviders();

  providersGrid.innerHTML = providers.map(provider => {
    const isConnected = state.connectedProviders.has(provider.id);
    const disabledClass = provider.implemented ? '' : 'disabled';

    // Auth method badges
    let authBadges = '';
    if (!provider.implemented) {
      authBadges += '<span class="provider-badge badge-coming-soon">Coming Soon</span>';
    } else if (!provider.requiresAuth) {
      authBadges += '<span class="provider-badge badge-public">Public API</span>';
    } else {
      if (provider.authTypes.includes('device_flow')) {
        authBadges += '<span class="provider-badge badge-device">Device Flow</span>';
      }
      if (provider.authTypes.includes('oauth_pkce')) {
        authBadges += '<span class="provider-badge badge-auth">OAuth</span>';
      }
    }

    // Capability badges
    let capBadges = '';
    if (provider.implemented && provider.capabilities) {
      if (provider.capabilities.browse) {
        capBadges += '<span class="provider-badge badge-cap-browse">Playlist</span>';
      }
      if (provider.capabilities.presentations) {
        capBadges += '<span class="provider-badge badge-cap-presentations">Presentations</span>';
      }
      if (provider.capabilities.instructions) {
        capBadges += '<span class="provider-badge badge-cap-instructions">Instructions</span>';
      }
      if (provider.capabilities.expandedInstructions) {
        capBadges += '<span class="provider-badge badge-cap-expanded">Expanded</span>';
      }
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
        <div class="badge-row auth-badges">${authBadges}</div>
        <div class="badge-row cap-badges">${capBadges}</div>
      </div>
    `;
  }).join('');

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

async function handleProviderClick(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) {
    showStatus('Provider not found', 'error');
    return;
  }

  state.currentProvider = provider;

  if (state.connectedProviders.has(providerId)) {
    state.currentAuth = state.connectedProviders.get(providerId) || null;
    await navigateToBrowser();
    return;
  }

  if (provider.requiresAuth()) {
    if (provider.supportsDeviceFlow()) {
      await startDeviceFlow();
    } else {
      showOAuthModal();
    }
    return;
  }

  state.connectedProviders.set(providerId, null);
  state.currentAuth = null;
  await navigateToBrowser();
}

function showOAuthModal() {
  if (!state.currentProvider) return;
  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;
  showModal('oauth');
}

async function startOAuthRedirect() {
  if (!state.currentProvider) return;

  try {
    const codeVerifier = state.currentProvider.generateCodeVerifier();
    sessionStorage.setItem(STORAGE_KEY_VERIFIER, codeVerifier);
    sessionStorage.setItem(STORAGE_KEY_PROVIDER, state.currentProvider.id);
    const { url } = await state.currentProvider.buildAuthUrl(codeVerifier, OAUTH_REDIRECT_URI);
    window.location.href = url;
  } catch (error) {
    showModal('error');
    errorMessage.textContent = `Failed to start OAuth: ${error}`;
  }
}

async function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state_param = urlParams.get('state');
  const error = urlParams.get('error');

  if (error) {
    window.history.replaceState({}, '', window.location.pathname);
    showStatus(`OAuth error: ${error}`, 'error');
    return;
  }

  if (!code) return;

  const codeVerifier = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
  const providerId = sessionStorage.getItem(STORAGE_KEY_PROVIDER) || state_param;

  sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
  sessionStorage.removeItem(STORAGE_KEY_PROVIDER);
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
  modalTitle.textContent = `Connecting to ${provider.name}`;
  showModal('processing');

  try {
    let authData: ContentProviderAuthData | null;

    // B1Church uses standard OAuth with client_secret (not PKCE)
    if (provider.id === 'b1church') {
      const b1Provider = provider as B1ChurchProvider;
      authData = await b1Provider.exchangeCodeForTokensWithSecret(code, OAUTH_REDIRECT_URI, B1_CLIENT_SECRET);
    } else {
      authData = await provider.exchangeCodeForTokens(code, codeVerifier, OAUTH_REDIRECT_URI);
    }

    if (!authData) {
      showModal('error');
      errorMessage.textContent = 'Failed to exchange authorization code for tokens.';
      return;
    }

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

async function startDeviceFlow() {
  if (!state.currentProvider) return;

  showModal('loading');
  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;

  try {
    const deviceAuth = await state.currentProvider.initiateDeviceFlow();

    if (!deviceAuth) {
      showModal('error');
      errorMessage.textContent = 'Failed to initiate device authorization. Please try again.';
      return;
    }

    state.deviceFlowData = deviceAuth;
    state.deviceFlowActive = true;
    state.slowDownCount = 0;

    showModal('code');
    verificationUrl.href = deviceAuth.verification_uri_complete || deviceAuth.verification_uri;
    verificationUrl.textContent = deviceAuth.verification_uri;
    userCode.textContent = deviceAuth.user_code;

    const qrUrl = deviceAuth.verification_uri_complete || `${deviceAuth.verification_uri}?user_code=${deviceAuth.user_code}`;
    qrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;

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

    if (Date.now() > expiresAt) {
      state.deviceFlowActive = false;
      showModal('error');
      errorMessage.textContent = 'Authorization expired. Please try again.';
      return;
    }

    try {
      const result = await state.currentProvider.pollDeviceFlowToken(state.deviceFlowData.device_code);

      if (result === null) {
        state.deviceFlowActive = false;
        showModal('error');
        errorMessage.textContent = 'Authorization failed or was denied.';
        return;
      }

      if ('error' in result) {
        if (result.shouldSlowDown) {
          state.slowDownCount++;
        }

        const delay = state.currentProvider.calculatePollDelay(baseInterval, state.slowDownCount);
        state.pollingInterval = window.setTimeout(poll, delay);
        return;
      }

      state.deviceFlowActive = false;
      state.currentAuth = result;
      state.connectedProviders.set(state.currentProvider.id, result);

      showModal('success');

      setTimeout(() => {
        closeModal();
        navigateToBrowser();
        renderProviders();
      }, 1500);

    } catch (error) {
      console.error('Polling error:', error);
      const delay = state.currentProvider!.calculatePollDelay(baseInterval, state.slowDownCount);
      state.pollingInterval = window.setTimeout(poll, delay);
    }
  };

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

async function navigateToBrowser() {
  state.currentView = 'browser';
  state.folderStack = [];

  providersView.classList.add('hidden');
  browserView.classList.remove('hidden');
  breadcrumb.classList.remove('hidden');

  updateBreadcrumb();
  await loadContent();
}

function navigateToProviders() {
  state.currentView = 'providers';
  state.currentProvider = null;
  state.folderStack = [];

  browserView.classList.add('hidden');
  breadcrumb.classList.add('hidden');
  providersView.classList.remove('hidden');

  renderProviders();
}

function handleBack() {
  if (state.folderStack.length > 0) {
    state.folderStack.pop();
    updateBreadcrumb();
    loadContent();
  } else {
    navigateToProviders();
  }
}

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

async function loadContent() {
  if (!state.currentProvider) return;

  showLoading(true);
  contentGrid.innerHTML = '';
  emptyEl.classList.add('hidden');

  try {
    let items: ContentItem[];

    if (state.folderStack.length === 0) {
      items = await state.currentProvider.getRootContents(state.currentAuth);
    } else {
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

function renderContent(items: ContentItem[]) {
  let html = items.map(item => {
    if (isContentFolder(item)) {
      return renderFolder(item);
    } else if (isContentFile(item)) {
      return renderFile(item);
    }
    return '';
  }).join('');

  // Add JSON viewer for all content views
  if (items.length > 0) {
    const allFiles = items.every(item => isContentFile(item));
    const allFolders = items.every(item => isContentFolder(item));
    const title = allFiles ? 'Playlist JSON' : allFolders ? 'Folders JSON' : 'Content JSON';
    html += renderJsonViewer(items, title);
  }

  contentGrid.innerHTML = html;

  contentGrid.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', () => {
      const folderId = card.getAttribute('data-folder-id')!;
      const folder = items.find(i => isContentFolder(i) && i.id === folderId) as ContentFolder;
      if (folder) {
        handleFolderClick(folder);
      }
    });
  });

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

function handleFolderClick(folder: ContentFolder) {
  const isVenue = folder.providerData?.venueId || folder.providerData?.level === 'playlist';

  if (isVenue && state.currentProvider) {
    showVenueChoiceModal(folder);
  } else {
    state.folderStack.push(folder);
    updateBreadcrumb();
    loadContent();
  }
}

function showVenueChoiceModal(folder: ContentFolder) {
  state.currentVenueFolder = folder;

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
          <button id="view-presentations-btn" class="venue-btn presentations-btn">
            <span class="btn-icon">🎬</span>
            <span class="btn-text">Presentations</span>
            <span class="btn-desc">Structured sections with media files</span>
          </button>
          <button id="view-instructions-btn" class="venue-btn instructions-btn">
            <span class="btn-icon">📖</span>
            <span class="btn-text">Instructions</span>
            <span class="btn-desc">Headers and sections only</span>
          </button>
          <button id="view-expanded-btn" class="venue-btn expanded-btn">
            <span class="btn-icon">📚</span>
            <span class="btn-text">Expanded</span>
            <span class="btn-desc">Full hierarchy with all actions</span>
          </button>
        </div>
        <button id="venue-choice-cancel" class="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  const existingModal = document.getElementById('venue-choice-modal');
  if (existingModal) existingModal.remove();

  document.body.insertAdjacentHTML('beforeend', choiceHtml);

  document.getElementById('view-playlist-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsPlaylist(folder);
  });

  document.getElementById('view-presentations-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsPresentations(folder);
  });

  document.getElementById('view-instructions-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsInstructions(folder);
  });

  document.getElementById('view-expanded-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsExpandedInstructions(folder);
  });

  document.getElementById('venue-choice-cancel')!.addEventListener('click', closeVenueChoiceModal);

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

function viewAsPlaylist(folder: ContentFolder) {
  state.folderStack.push(folder);
  updateBreadcrumb();
  loadContent();
}

async function viewAsPresentations(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const plan = await state.currentProvider.getPresentations(folder, state.currentAuth);

    if (!plan) {
      showStatus('This provider does not support presentations view', 'error');
      showLoading(false);
      return;
    }

    state.currentPlan = plan;
    state.currentVenueFolder = folder;
    state.currentView = 'plan';

    state.folderStack.push(folder);
    updateBreadcrumb();

    showLoading(false);
    renderPlanView(plan);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load presentations: ${error}`, 'error');
  }
}

async function viewAsInstructions(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const instructions = await state.currentProvider.getInstructions(folder, state.currentAuth);

    if (!instructions) {
      showStatus('This provider does not support instructions view', 'error');
      showLoading(false);
      return;
    }

    state.currentInstructions = instructions;
    state.currentVenueFolder = folder;
    state.currentView = 'instructions';

    state.folderStack.push(folder);
    updateBreadcrumb();

    showLoading(false);
    renderInstructionsView(instructions);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load instructions: ${error}`, 'error');
  }
}

async function viewAsExpandedInstructions(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const instructions = await state.currentProvider.getExpandedInstructions(folder, state.currentAuth);

    if (!instructions) {
      showStatus('This provider does not support expanded instructions view', 'error');
      showLoading(false);
      return;
    }

    state.currentInstructions = instructions;
    state.currentVenueFolder = folder;
    state.currentView = 'instructions';

    state.folderStack.push(folder);
    updateBreadcrumb();

    showLoading(false);
    renderInstructionsView(instructions, true);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load expanded instructions: ${error}`, 'error');
  }
}

function renderJsonViewer(data: unknown, title: string = 'JSON Data'): string {
  const jsonStr = JSON.stringify(data, null, 2);
  return `
    <div class="json-viewer">
      <div class="json-viewer-header">
        <h3>${title}</h3>
        <button class="json-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.textContent).then(() => this.textContent = 'Copied!').catch(() => this.textContent = 'Failed')">Copy</button>
      </div>
      <pre class="json-content">${jsonStr.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  `;
}

function renderPlanView(plan: Plan) {
  browserTitle.textContent = `${plan.name} (Presentations)`;

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

  html += renderJsonViewer(plan, 'Plan JSON');

  contentGrid.innerHTML = html;
  emptyEl.classList.add('hidden');

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
      if ((e.target as HTMLElement).classList.contains('play-presentation-btn')) return;

      const sectionIdx = parseInt(card.getAttribute('data-section')!);
      const presentationIdx = parseInt(card.getAttribute('data-presentation')!);
      const presentation = plan.sections[sectionIdx].presentations[presentationIdx];
      showPresentationDetails(presentation);
    });
  });
}

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
  console.log('Presentation details:', presentation);
}

function playPlanFiles(files: ContentItem[]) {
  if (files.length === 0) {
    showStatus('No files to play', 'error');
    return;
  }

  const firstFile = files[0];
  if (isContentFile(firstFile)) {
    window.open(firstFile.url, '_blank');
    showStatus(`Playing: ${firstFile.title} (${files.length} total files)`, 'success');
  }

  console.log('Playlist:', files);
}

function renderInstructionsView(instructions: Instructions, isExpanded: boolean = false) {
  const viewType = isExpanded ? 'Expanded' : 'Instructions';
  browserTitle.textContent = `${instructions.venueName || 'Instructions'} (${viewType})`;

  const countItems = (items: InstructionItem[]): number => {
    let count = items.length;
    for (const item of items) {
      if (item.children) count += countItems(item.children);
    }
    return count;
  };

  const totalItems = countItems(instructions.items);

  let html = `
    <div class="instructions-view">
      <div class="instructions-header">
        <div class="instructions-info">
          <h2>${instructions.venueName || 'Instructions'}</h2>
          <p class="instructions-stats">${instructions.items.length} top-level items • ${totalItems} total items</p>
        </div>
      </div>
      <div class="instructions-tree">
  `;

  const renderItem = (item: InstructionItem, depth: number = 0): string => {
    const indent = depth * 20;
    const hasChildren = item.children && item.children.length > 0;
    const typeIcon = item.itemType === 'header' ? '📁' :
                     item.itemType === 'lessonSection' ? '📋' :
                     item.itemType === 'lessonAction' ? '▶️' :
                     item.itemType === 'lessonAddOn' ? '➕' : '📄';

    let itemHtml = `
      <div class="instruction-item" style="margin-left: ${indent}px;" data-embed-url="${item.embedUrl || ''}">
        <div class="instruction-content">
          <span class="instruction-icon">${typeIcon}</span>
          <span class="instruction-label">${item.label || 'Untitled'}</span>
          ${item.itemType ? `<span class="instruction-type">${item.itemType}</span>` : ''}
          ${item.seconds ? `<span class="instruction-seconds">${item.seconds}s</span>` : ''}
        </div>
        ${item.description ? `<div class="instruction-description">${item.description}</div>` : ''}
        ${item.embedUrl ? `<a href="${item.embedUrl}" target="_blank" class="instruction-embed-link">Open Embed</a>` : ''}
      </div>
    `;

    if (hasChildren) {
      itemHtml += item.children!.map(child => renderItem(child, depth + 1)).join('');
    }

    return itemHtml;
  };

  html += instructions.items.map(item => renderItem(item)).join('');

  html += `
      </div>
    </div>
  `;

  html += renderJsonViewer(instructions, `${viewType} JSON`);

  contentGrid.innerHTML = html;
  emptyEl.classList.add('hidden');

  contentGrid.querySelectorAll('.instruction-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('instruction-embed-link')) return;
      const embedUrl = item.getAttribute('data-embed-url');
      if (embedUrl) {
        showStatus(`Embed URL: ${embedUrl}`, 'success');
        console.log('Instruction item:', item);
      }
    });
  });
}

function handleFileClick(file: ContentItem & { type: 'file' }) {
  window.open(file.url, '_blank');
  showStatus(`Opening: ${file.title}`, 'success');
}

function showLoading(show: boolean) {
  if (show) {
    loadingEl.classList.remove('hidden');
  } else {
    loadingEl.classList.add('hidden');
  }
}

function showStatus(message: string, type: 'success' | 'error' = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove('hidden');

  setTimeout(() => {
    statusEl.classList.add('hidden');
  }, 4000);
}

init();

console.log('Content Provider Helper Playground loaded');
console.log('Available providers:', getAvailableProviders());
console.log('OAuth redirect URI:', OAUTH_REDIRECT_URI);
