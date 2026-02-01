import { getAvailableProviders, getProvider, IProvider, ContentFolder, ContentItem, ContentProviderAuthData, DeviceAuthorizationResponse, isContentFolder, isContentFile, Plan, PlanPresentation, Instructions, InstructionItem, B1ChurchProvider, PlanningCenterProvider, FormatResolver, ProviderCapabilities, ContentFile, OAuthHelper, DeviceFlowHelper } from "../src";
import type { ResolvedFormatMeta } from "../src";

const OAUTH_REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;
const STORAGE_KEY_VERIFIER = 'oauth_code_verifier';
const STORAGE_KEY_PROVIDER = 'oauth_provider_id';

// Configure client IDs for OAuth providers (using FreeShow's registered app credentials for testing)
const PCO_CLIENT_ID = '35d1112d839d678ce3f1de730d2cff0b81038c2944b11c5e2edf03f8b43abc05';
const B1_CLIENT_ID = 'nsowldn58dk';

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

// Auth helpers (used instead of methods on provider)
const oauthHelper = new OAuthHelper();
const deviceFlowHelper = new DeviceFlowHelper();

interface AppState {
  currentView: 'providers' | 'browser' | 'plan' | 'instructions';
  currentProvider: IProvider | null;
  currentAuth: ContentProviderAuthData | null;
  currentPath: string;
  breadcrumbTitles: string[];
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
  currentPath: '',
  breadcrumbTitles: [],
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
const docsView = document.getElementById('docs-view')!;
const browserView = document.getElementById('browser-view')!;
const providersGrid = document.getElementById('providers-grid')!;
const mainTabs = document.getElementById('main-tabs')!;
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

// Auth choice elements
const authChoiceSection = document.getElementById('auth-choice-section')!;
const authChoiceDeviceBtn = document.getElementById('auth-choice-device')!;
const authChoiceOAuthBtn = document.getElementById('auth-choice-oauth')!;

// Form login elements
const formLoginSection = document.getElementById('form-login-section')!;
const loginEmail = document.getElementById('login-email')! as HTMLInputElement;
const loginPassword = document.getElementById('login-password')! as HTMLInputElement;
const formLoginBtn = document.getElementById('form-login-btn')!;
const formLoginError = document.getElementById('form-login-error')!;

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
  formLoginBtn.addEventListener('click', handleFormLoginSubmit);
  authChoiceDeviceBtn.addEventListener('click', () => startDeviceFlow());
  authChoiceOAuthBtn.addEventListener('click', () => showOAuthModal());

  // Handle Enter key in form login fields
  loginEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginPassword.focus();
  });
  loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleFormLoginSubmit();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Tab switching
  mainTabs.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab')!;
      switchTab(tab);
    });
  });
}

function switchTab(tab: string) {
  // Update tab buttons
  mainTabs.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });

  // Show/hide views
  providersView.classList.toggle('hidden', tab !== 'providers');
  docsView.classList.toggle('hidden', tab !== 'docs');

  // Hide browser view when switching tabs (user needs to select a provider again)
  if (tab !== 'providers') {
    browserView.classList.add('hidden');
    breadcrumb.classList.add('hidden');
  }
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
      if (provider.authTypes.includes('form_login')) {
        authBadges += '<span class="provider-badge badge-form">Login</span>';
      }
    }

    // Capability badges - show all 4 formats with native vs derived indicators
    let capBadges = '';
    if (provider.implemented && provider.capabilities) {
      const caps = provider.capabilities;

      // Determine what formats can be derived
      const canDerivePlaylist = caps.presentations || caps.instructions;
      const canDerivePresentations = caps.instructions || caps.playlist;
      const canDeriveExpanded = caps.presentations || caps.playlist;

      // Playlist badge
      if (caps.playlist) {
        capBadges += '<span class="provider-badge badge-cap-playlist badge-native" title="Native support">Playlist</span>';
      } else if (canDerivePlaylist) {
        capBadges += '<span class="provider-badge badge-cap-playlist badge-derived" title="Derived from other formats">Playlist*</span>';
      }

      // Presentations badge
      if (caps.presentations) {
        capBadges += '<span class="provider-badge badge-cap-presentations badge-native" title="Native support">Presentations</span>';
      } else if (canDerivePresentations) {
        capBadges += '<span class="provider-badge badge-cap-presentations badge-derived" title="Derived from other formats">Presentations*</span>';
      }

      // Instructions badge
      if (caps.instructions) {
        capBadges += '<span class="provider-badge badge-cap-instructions badge-native" title="Native support">Instructions</span>';
      } else if (canDeriveExpanded) {
        capBadges += '<span class="provider-badge badge-cap-instructions badge-derived" title="Derived from other formats">Instructions*</span>';
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

  if (provider.requiresAuth) {
    const supportsDeviceFlow = deviceFlowHelper.supportsDeviceFlow(provider.config);
    const supportsOAuth = provider.authTypes.includes('oauth_pkce');

    // Show choice if both OAuth and Device Flow are supported
    if (supportsDeviceFlow && supportsOAuth) {
      showAuthChoiceModal();
    } else if (supportsDeviceFlow) {
      await startDeviceFlow();
    } else if (provider.authTypes.includes('form_login')) {
      showFormLoginModal();
    } else {
      showOAuthModal();
    }
    return;
  }

  state.connectedProviders.set(providerId, null);
  state.currentAuth = null;
  await navigateToBrowser();
}

function showAuthChoiceModal() {
  if (!state.currentProvider) return;
  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;
  showModal('auth_choice');
}

function showOAuthModal() {
  if (!state.currentProvider) return;
  modalTitle.textContent = `Connect to ${state.currentProvider.name}`;
  showModal('oauth');
}

function showFormLoginModal() {
  if (!state.currentProvider) return;
  modalTitle.textContent = `Login to ${state.currentProvider.name}`;
  loginEmail.value = '';
  loginPassword.value = '';
  formLoginError.classList.add('hidden');
  showModal('form_login');
  // Focus email field after modal opens
  setTimeout(() => loginEmail.focus(), 100);
}

async function handleFormLoginSubmit() {
  if (!state.currentProvider) return;

  const email = loginEmail.value.trim();
  const pwd = loginPassword.value;

  if (!email || !pwd) {
    formLoginError.textContent = 'Please enter email and password';
    formLoginError.classList.remove('hidden');
    return;
  }

  showModal('processing');

  try {
    const providerAny = state.currentProvider as any;
    if (typeof providerAny.performLogin !== 'function') {
      showModal('error');
      errorMessage.textContent = 'This provider does not support form login';
      return;
    }

    const auth = await providerAny.performLogin(email, pwd);

    if (auth) {
      state.currentAuth = auth;
      state.connectedProviders.set(state.currentProvider.id, auth);
      showModal('success');

      setTimeout(() => {
        closeModal();
        navigateToBrowser();
        renderProviders();
      }, 1500);
    } else {
      showModal('form_login');
      formLoginError.textContent = 'Login failed. Check your credentials.';
      formLoginError.classList.remove('hidden');
    }
  } catch (error) {
    showModal('error');
    errorMessage.textContent = `Login error: ${error}`;
  }
}

async function startOAuthRedirect() {
  if (!state.currentProvider) return;

  try {
    const codeVerifier = oauthHelper.generateCodeVerifier();
    sessionStorage.setItem(STORAGE_KEY_VERIFIER, codeVerifier);
    sessionStorage.setItem(STORAGE_KEY_PROVIDER, state.currentProvider.id);

    let url: string;
    // B1Church has its own OAuth URL format
    if (state.currentProvider.id === 'b1church') {
      const b1Provider = state.currentProvider as B1ChurchProvider;
      const result = await b1Provider.buildAuthUrl(codeVerifier, OAUTH_REDIRECT_URI);
      url = result.url;
    } else {
      const result = await oauthHelper.buildAuthUrl(state.currentProvider.config, codeVerifier, OAUTH_REDIRECT_URI);
      url = result.url;
    }

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

    // B1Church now uses PKCE
    if (provider.id === 'b1church') {
      const b1Provider = provider as B1ChurchProvider;
      authData = await b1Provider.exchangeCodeForTokensWithPKCE(code, OAUTH_REDIRECT_URI, codeVerifier);
    } else {
      authData = await oauthHelper.exchangeCodeForTokens(provider.config, provider.id, code, codeVerifier, OAUTH_REDIRECT_URI);
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
    const deviceAuth = await deviceFlowHelper.initiateDeviceFlow(state.currentProvider.config);

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
      const result = await deviceFlowHelper.pollDeviceFlowToken(state.currentProvider.config, state.deviceFlowData.device_code);

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

        const delay = deviceFlowHelper.calculatePollDelay(baseInterval, state.slowDownCount);
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
      const delay = deviceFlowHelper.calculatePollDelay(baseInterval, state.slowDownCount);
      state.pollingInterval = window.setTimeout(poll, delay);
    }
  };

  const initialDelay = deviceFlowHelper.calculatePollDelay(baseInterval, 0);
  state.pollingInterval = window.setTimeout(poll, initialDelay);
}

function showModal(view: 'loading' | 'code' | 'success' | 'error' | 'oauth' | 'processing' | 'form_login' | 'auth_choice') {
  modal.classList.remove('hidden');
  modalLoading.classList.add('hidden');
  modalCode.classList.add('hidden');
  modalSuccess.classList.add('hidden');
  modalError.classList.add('hidden');
  oauthSection.classList.add('hidden');
  oauthProcessing.classList.add('hidden');
  formLoginSection.classList.add('hidden');
  authChoiceSection.classList.add('hidden');

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
    case 'form_login':
      formLoginSection.classList.remove('hidden');
      break;
    case 'auth_choice':
      authChoiceSection.classList.remove('hidden');
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

  const supportsDeviceFlow = deviceFlowHelper.supportsDeviceFlow(state.currentProvider.config);
  const supportsOAuth = state.currentProvider.authTypes.includes('oauth_pkce');

  // Show choice if both OAuth and Device Flow are supported
  if (supportsDeviceFlow && supportsOAuth) {
    showAuthChoiceModal();
  } else if (supportsDeviceFlow) {
    startDeviceFlow();
  } else {
    showOAuthModal();
  }
}

async function navigateToBrowser() {
  state.currentView = 'browser';
  state.currentPath = '';
  state.breadcrumbTitles = [];

  providersView.classList.add('hidden');
  browserView.classList.remove('hidden');
  breadcrumb.classList.remove('hidden');

  updateBreadcrumb();
  await loadContent();
}

function navigateToProviders() {
  state.currentView = 'providers';
  state.currentProvider = null;
  state.currentPath = '';
  state.breadcrumbTitles = [];

  browserView.classList.add('hidden');
  breadcrumb.classList.add('hidden');
  providersView.classList.remove('hidden');

  renderProviders();
}

function goBack() {
  if (!state.currentPath) return;

  // Remove last segment from path
  const segments = state.currentPath.split('/').filter(Boolean);
  segments.pop();
  state.currentPath = segments.length > 0 ? '/' + segments.join('/') : '';

  // Remove last breadcrumb title
  state.breadcrumbTitles.pop();
}

function handleBack() {
  if (state.currentPath) {
    goBack();
    updateBreadcrumb();
    loadContent();
  } else {
    navigateToProviders();
  }
}

function updateBreadcrumb() {
  const parts: string[] = [state.currentProvider?.name || 'Unknown'];
  state.breadcrumbTitles.forEach(title => {
    parts.push(title);
  });

  breadcrumbPath.innerHTML = parts
    .map((part, i) => i === parts.length - 1 ? `<span>${part}</span>` : part)
    .join(' / ');

  browserTitle.textContent = state.breadcrumbTitles.length > 0
    ? state.breadcrumbTitles[state.breadcrumbTitles.length - 1]
    : state.currentProvider?.name || 'Content';
}

async function loadContent() {
  if (!state.currentProvider) return;

  showLoading(true);
  contentGrid.innerHTML = '';
  emptyEl.classList.add('hidden');

  try {
    const items = await state.currentProvider.browse(state.currentPath || null, state.currentAuth);

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
  const imageHtml = file.image
    ? `<img class="card-image" src="${file.image}" alt="${file.title}" onerror="this.outerHTML='<div class=\\'card-image placeholder\\'>${file.mediaType === 'video' ? '🎬' : '🖼️'}</div>'">`
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
  // Check if this is a leaf folder (offers view modes)
  // Providers set isLeaf: true to indicate the bottom of the browse tree
  const isLeafFolder = folder.isLeaf;

  if (isLeafFolder && state.currentProvider) {
    showVenueChoiceModal(folder);
  } else {
    // Navigate into the folder using its path
    state.currentPath = folder.path;
    state.breadcrumbTitles.push(folder.title);
    updateBreadcrumb();
    loadContent();
  }
}

function showVenueChoiceModal(folder: ContentFolder) {
  state.currentVenueFolder = folder;

  // Get provider capabilities to determine native vs derived
  const caps = state.currentProvider?.capabilities;

  // Helper to create format button with native/derived indicator
  const formatBtn = (id: string, icon: string, name: string, desc: string, isNative: boolean, sourceFormat?: string) => {
    const nativeLabel = isNative ? '<span class="native-badge">Native</span>' : `<span class="derived-badge">Derived${sourceFormat ? ` from ${sourceFormat}` : ''}</span>`;
    const btnClass = isNative ? 'venue-btn native' : 'venue-btn derived';
    return `
      <button id="${id}" class="${btnClass}">
        <span class="btn-icon">${icon}</span>
        <span class="btn-text">${name}</span>
        ${nativeLabel}
        <span class="btn-desc">${desc}</span>
      </button>
    `;
  };

  // Determine source format for each derived format
  const getPlaylistSource = () => caps?.presentations ? 'Presentations' : caps?.instructions ? 'Instructions' : 'Playlist';
  const getPresentationsSource = () => caps?.instructions ? 'Instructions' : 'Playlist';
  const getInstructionsSource = () => caps?.presentations ? 'Presentations' : 'Playlist';

  const choiceHtml = `
    <div class="venue-choice-modal" id="venue-choice-modal">
      <div class="venue-choice-content">
        <h2>Choose View for "${folder.title}"</h2>
        <p>How would you like to view this content?</p>
        <p class="format-legend"><span class="native-badge">Native</span> = Direct provider support &nbsp; <span class="derived-badge">Derived</span> = Converted from another format</p>
        <div class="venue-choice-buttons">
          ${formatBtn('view-playlist-btn', '📋', 'Playlist', 'Simple list of media files', !!caps?.playlist, getPlaylistSource())}
          ${formatBtn('view-presentations-btn', '🎬', 'Presentations', 'Structured sections with media files', !!caps?.presentations, getPresentationsSource())}
          ${formatBtn('view-expanded-btn', '📚', 'Instructions', 'Full hierarchy with all actions', !!caps?.instructions, getInstructionsSource())}
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

  document.getElementById('view-expanded-btn')!.addEventListener('click', () => {
    closeVenueChoiceModal();
    viewAsInstructions(folder);
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

async function viewAsPlaylist(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const resolver = new FormatResolver(state.currentProvider);
    const { data: playlist, meta } = await resolver.getPlaylistWithMeta(folder.path, state.currentAuth);

    if (!playlist || playlist.length === 0) {
      // Fallback to regular browse if no playlist
      state.currentPath = folder.path;
      state.breadcrumbTitles.push(folder.title);
      updateBreadcrumb();
      showLoading(false);
      loadContent();
      return;
    }

    state.currentVenueFolder = folder;
    state.currentPath = folder.path;
    state.breadcrumbTitles.push(folder.title);
    updateBreadcrumb();

    showLoading(false);
    renderPlaylistView(playlist, meta);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load playlist: ${error}`, 'error');
  }
}

async function viewAsPresentations(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const resolver = new FormatResolver(state.currentProvider);
    const { data: plan, meta } = await resolver.getPresentationsWithMeta(folder.path, state.currentAuth);

    if (!plan) {
      showStatus('This provider does not support presentations view', 'error');
      showLoading(false);
      return;
    }

    state.currentPlan = plan;
    state.currentVenueFolder = folder;
    state.currentView = 'plan';

    state.currentPath = folder.path;
    state.breadcrumbTitles.push(folder.title);
    updateBreadcrumb();

    showLoading(false);
    renderPlanView(plan, meta);

  } catch (error) {
    showLoading(false);
    showStatus(`Failed to load presentations: ${error}`, 'error');
  }
}

async function viewAsInstructions(folder: ContentFolder) {
  if (!state.currentProvider) return;

  showLoading(true);

  try {
    const resolver = new FormatResolver(state.currentProvider);
    const { data: instructions, meta } = await resolver.getInstructionsWithMeta(folder.path, state.currentAuth);

    if (!instructions) {
      showStatus('This provider does not support expanded instructions view', 'error');
      showLoading(false);
      return;
    }

    state.currentInstructions = instructions;
    state.currentVenueFolder = folder;
    state.currentView = 'instructions';

    state.currentPath = folder.path;
    state.breadcrumbTitles.push(folder.title);
    updateBreadcrumb();

    showLoading(false);
    renderInstructionsView(instructions, true, meta);

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

function renderFormatSourceBadge(meta: ResolvedFormatMeta): string {
  if (meta.isNative) {
    return '<span class="format-source-badge native">Native</span>';
  }
  const lossyWarning = meta.isLossy ? ' (lossy)' : '';
  return `<span class="format-source-badge derived">Derived from ${meta.sourceFormat}${lossyWarning}</span>`;
}

function renderPlaylistView(playlist: ContentFile[], meta: ResolvedFormatMeta) {
  browserTitle.textContent = `Playlist`;

  let html = `
    <div class="playlist-view">
      <div class="playlist-header">
        <div class="playlist-info">
          <h2>Playlist</h2>
          ${renderFormatSourceBadge(meta)}
          <p class="playlist-stats">${playlist.length} files</p>
          <button id="play-all-btn" class="play-all-btn">▶ Play All</button>
        </div>
      </div>
      <div class="playlist-files">
  `;

  playlist.forEach((file, index) => {
    const imageHtml = file.image
      ? `<img class="file-thumb" src="${file.image}" alt="${file.title}" onerror="this.outerHTML='<span class=\\'file-thumb-icon\\'>${file.mediaType === 'video' ? '🎬' : '🖼️'}</span>'">`
      : `<span class="file-thumb-icon">${file.mediaType === 'video' ? '🎬' : '🖼️'}</span>`;

    html += `
      <div class="playlist-file" data-file-index="${index}">
        ${imageHtml}
        <div class="playlist-file-info">
          <span class="playlist-file-title">${file.title}</span>
          <span class="playlist-file-type">${file.mediaType}</span>
          ${file.seconds ? `<span class="playlist-file-duration">${file.seconds}s</span>` : ''}
        </div>
        <a href="${file.url}" target="_blank" class="playlist-file-link">Open</a>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  html += renderJsonViewer(playlist, 'Playlist JSON');

  contentGrid.innerHTML = html;
  emptyEl.classList.add('hidden');

  document.getElementById('play-all-btn')?.addEventListener('click', () => {
    if (playlist.length > 0) {
      window.open(playlist[0].url, '_blank');
      showStatus(`Playing: ${playlist[0].title} (${playlist.length} total files)`, 'success');
    }
  });
}

function renderPlanView(plan: Plan, meta: ResolvedFormatMeta) {
  browserTitle.textContent = `${plan.name} (Presentations)`;

  let html = `
    <div class="plan-view">
      <div class="plan-header">
        ${plan.image ? `<img class="plan-image" src="${plan.image}" alt="${plan.name}">` : ''}
        <div class="plan-info">
          <h2>${plan.name}</h2>
          ${renderFormatSourceBadge(meta)}
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
      <span class="file-seconds">${file.seconds ? `${file.seconds}s` : ''}</span>
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

function renderInstructionsView(instructions: Instructions, _isExpanded: boolean = false, meta?: ResolvedFormatMeta) {
  const viewType = 'Instructions';
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
          ${meta ? renderFormatSourceBadge(meta) : ''}
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
