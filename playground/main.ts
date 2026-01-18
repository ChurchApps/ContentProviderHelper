import {
  getAvailableProviders,
  getProvider,
  ContentProvider,
  ContentFolder,
  ContentItem,
  ContentProviderAuthData,
  isContentFolder,
  isContentFile,
  ProviderInfo,
} from "../src";

// State management
interface AppState {
  currentView: 'providers' | 'browser';
  currentProvider: ContentProvider | null;
  currentAuth: ContentProviderAuthData | null;
  folderStack: ContentFolder[];
  connectedProviders: Map<string, ContentProviderAuthData | null>;
}

const state: AppState = {
  currentView: 'providers',
  currentProvider: null,
  currentAuth: null,
  folderStack: [],
  connectedProviders: new Map(),
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

// Provider icons/emojis
const providerIcons: Record<string, string> = {
  aplay: '🎬',
  signpresenter: '📺',
  lessonschurch: '⛪',
};

// Initialize
function init() {
  renderProviders();
  setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
  backBtn.addEventListener('click', handleBack);
}

// Render provider grid
function renderProviders() {
  const providers = getAvailableProviders();

  providersGrid.innerHTML = providers.map(provider => {
    const icon = providerIcons[provider.id] || '📦';
    const isConnected = state.connectedProviders.has(provider.id);

    let badges = '';
    if (!provider.requiresAuth) {
      badges += '<span class="provider-badge badge-public">Public API</span>';
    } else {
      badges += '<span class="provider-badge badge-auth">Auth Required</span>';
    }
    if (provider.supportsDeviceFlow) {
      badges += '<span class="provider-badge badge-device">Device Flow</span>';
    }

    return `
      <div class="card provider-card" data-provider-id="${provider.id}">
        <div class="card-image placeholder">${icon}</div>
        <h3 class="card-title">${provider.name}</h3>
        <p class="card-subtitle">${isConnected ? '✓ Connected' : 'Click to connect'}</p>
        <div>${badges}</div>
      </div>
    `;
  }).join('');

  // Add click handlers
  providersGrid.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
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

  // Check if auth is needed
  if (provider.requiresAuth()) {
    // For now, just show a message - in a real app you'd implement OAuth
    showStatus(`${provider.name} requires authentication. For testing, only public APIs work in the playground.`, 'error');
    return;
  }

  // No auth needed - connect directly
  state.connectedProviders.set(providerId, null);
  state.currentAuth = null;

  // Navigate to browser
  await navigateToBrowser();
}

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
  state.folderStack.push(folder);
  updateBreadcrumb();
  loadContent();
}

// Handle file click
function handleFileClick(file: ContentItem & { type: 'file' }) {
  // Open the file URL in a new tab
  window.open(file.url, '_blank');
  showStatus(`Opening: ${file.title}`, 'success');
}

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
