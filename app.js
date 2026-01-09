(function () {
  // Check if Azure Storage Blob SDK is loaded
  let BlobServiceClient, BlockBlobClient;
  if (window.azureStorageBlob) {
    ({ BlobServiceClient, BlockBlobClient } = window.azureStorageBlob);
  } else {
    console.warn('Azure Storage Blob SDK not loaded. Upload functionality may be limited.');
  }

  const el = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);
  ;

  const state = {
    apiBase: localStorage.getItem('apiBase') || '',
    apiKey: localStorage.getItem('apiKey') || '',
    assets: [],
    favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
    tags: JSON.parse(localStorage.getItem('tags') || '{}'),
    descriptions: JSON.parse(localStorage.getItem('descriptions') || '{}'),
    view: localStorage.getItem('view') || 'grid',
    sort: 'created_at_desc',
    search: '',
    filter: 'all',
    batchMode: false,
    selectedAssets: new Set(),
    currentPreviewIndex: -1,
    uploadQueue: []
  };

  // Initialize
  function init() {
    setupConfig();
    setupUpload();
    setupToolbar();
    setupModals();
    setupEventListeners();
    refreshList();
  }

  // Configuration Panel
  function setupConfig() {
  el('apiBase').value = state.apiBase;
  el('apiKey').value = state.apiKey;

  el('saveCfg').addEventListener('click', () => {
    state.apiBase = el('apiBase').value.trim();
    state.apiKey = el('apiKey').value.trim();
    localStorage.setItem('apiBase', state.apiBase);
    localStorage.setItem('apiKey', state.apiKey);
      showToast('Configuration saved', 'success');
      toggleConfigPanel(false);
    });

    const openConfigBtn = el('openConfig');
    const toggleConfigBtn = el('toggleConfig');
    
    if (openConfigBtn) {
      openConfigBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleConfigPanel(true);
      });
    }
    
    if (toggleConfigBtn) {
      toggleConfigBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleConfigPanel(false);
      });
    }
    
    // Add click outside to close for all modals
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        closeAllModals();
      }
    });
  }

  function toggleConfigPanel(show) {
    const panel = qs('.config-panel') || el('configPanel');
    if (!panel) {
      console.error('Config panel not found');
      return;
    }
    if (show) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  }

  // API Helper Functions
  function api() {
    if (!state.apiBase) {
      showToast('Please configure API Base URL first', 'error');
      toggleConfigPanel(true);
      throw new Error('API base URL is not set');
    }
    const instance = axios.create({ baseURL: state.apiBase });
    instance.interceptors.request.use((config) => {
      config.headers['x-api-key'] = state.apiKey || '';
      return config;
    });
    return instance;
  }

  function fmtBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US');
  }

  // Toast Notification
  function showToast(message, type = 'info') {
    const toast = el('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // Upload Functions
  function setupUpload() {
    const fileInput = el('fileInput');
    const dropzone = el('dropzone');
    const uploadBtnHeader = el('uploadBtnHeader');

    if (uploadBtnHeader) {
      uploadBtnHeader.addEventListener('click', () => fileInput.click());
    }
    if (fileInput) {
      fileInput.addEventListener('change', handleFileSelect);
    }
    if (dropzone) {
      dropzone.addEventListener('click', () => fileInput.click());
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) {
          handleFiles(Array.from(dt.files));
        }
      });
    }
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }

  function handleFiles(files) {
    const previewContainer = el('uploadPreview') || el('uploadPreview-main');
    files.forEach(file => {
      const previewItem = createPreviewItem(file);
      previewContainer.appendChild(previewItem);
      state.uploadQueue.push({ file, previewItem });
    });
    processUploadQueue();
  }

  function createPreviewItem(file) {
    const item = document.createElement('div');
    item.className = 'preview-item';
    
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      item.appendChild(img);
    } else {
      item.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;">📄</div>`;
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-preview';
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => {
      item.remove();
      state.uploadQueue = state.uploadQueue.filter(q => q.previewItem !== item);
    };
    item.appendChild(removeBtn);

    return item;
  }

  async function processUploadQueue() {
    while (state.uploadQueue.length > 0) {
      const { file, previewItem } = state.uploadQueue.shift();
      await uploadSingle(file, previewItem);
    }
    await refreshList();
  }

  async function uploadSingle(file, previewItem) {
    // Check if API is configured before upload
    if (!state.apiBase) {
      showToast('Please configure API Base URL first', 'error');
      toggleConfigPanel(true);
      previewItem.remove();
      return;
    }

    const progressItem = createProgressItem(file.name);
    const progressContainer = el('progressList') || el('progressList-main');
    if (progressContainer) {
      progressContainer.appendChild(progressItem.root);
    }

    try {
    const body = {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size
    };

    const { data: created } = await api().post('/api/assets', body);
    const { id, uploadUrl, blobUrl } = created;

      if (!BlockBlobClient) {
        throw new Error('Azure Storage Blob SDK not loaded. Please refresh the page.');
      }
      const blockBlobClient = new BlockBlobClient(uploadUrl);
      await blockBlobClient.uploadData(file, {
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
      onProgress: (ev) => {
        const p = Math.min(99, (ev.loadedBytes / file.size) * 100);
          progressItem.set(p);
        },
        blobHTTPHeaders: { blobContentType: file.type || undefined }
      });

      progressItem.set(100);
      await api().put(`/api/assets/${encodeURIComponent(id)}`, { status: 'uploaded', blobUrl });
      
      previewItem.remove();
      showToast(`${file.name} uploaded successfully`, 'success');
    } catch (error) {
      console.error('Upload error:', error);
      
      // Provide more specific error messages
      if (error.message && error.message.includes('API base URL is not set')) {
        showToast('Please configure API Base URL first', 'error');
        toggleConfigPanel(true);
      } else if (error.response) {
        const status = error.response.status;
        if (status === 401) {
          showToast('Authentication failed, please check API Key', 'error');
        } else {
          showToast(`Upload failed: ${error.response.statusText || 'Server error'}`, 'error');
        }
      } else if (error.request) {
        showToast('Cannot connect to server, please check API Base URL', 'error');
      } else {
        showToast(`Upload failed: ${file.name}`, 'error');
      }
      progressItem.root.style.opacity = '0.5';
    }
  }

  function createProgressItem(name) {
    const item = document.createElement('div');
    item.className = 'progress-item';
    item.innerHTML = `
      <div class="file-name">${name}</div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: 0%"></div>
      </div>
      <div class="progress-text">0%</div>
    `;
    const fill = item.querySelector('.progress-bar-fill');
    const text = item.querySelector('.progress-text');
    return {
      root: item,
      set(p) {
        fill.style.width = `${p}%`;
        text.textContent = `${Math.floor(p)}%`;
        if (p >= 100) {
          setTimeout(() => item.remove(), 1000);
        }
      }
    };
  }

  // Toolbar
  function setupToolbar() {
    el('searchInput').addEventListener('input', (e) => {
      state.search = e.target.value.toLowerCase();
      el('clearSearch').style.display = state.search ? 'block' : 'none';
      renderList();
    });

    el('clearSearch').addEventListener('click', () => {
      el('searchInput').value = '';
      state.search = '';
      el('clearSearch').style.display = 'none';
      renderList();
    });

    el('filterSelect').addEventListener('change', (e) => {
      state.filter = e.target.value;
      renderList();
    });

    el('sortSelect').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderList();
    });

    el('gridViewBtn').addEventListener('click', () => setView('grid'));
    el('listViewBtn').addEventListener('click', () => setView('list'));

    el('refreshBtn').addEventListener('click', refreshList);

    el('batchModeBtn').addEventListener('click', toggleBatchMode);
    el('selectAllBtn').addEventListener('click', selectAll);
    el('batchDeleteBtn').addEventListener('click', batchDelete);
    el('cancelBatchBtn').addEventListener('click', () => toggleBatchMode(false));
  }

  function setView(view) {
    state.view = view;
    localStorage.setItem('view', view);
    el('gridViewBtn').classList.toggle('active', view === 'grid');
    el('listViewBtn').classList.toggle('active', view === 'list');
    renderList();
  }

  function toggleBatchMode(enable) {
    state.batchMode = enable !== undefined ? enable : !state.batchMode;
    state.selectedAssets.clear();
    el('batchToolbar').style.display = state.batchMode ? 'flex' : 'none';
    document.body.classList.toggle('batch-mode', state.batchMode);
    renderList();
  }

  function selectAll() {
    const filtered = filteredAndSorted();
    if (state.selectedAssets.size === filtered.length) {
      state.selectedAssets.clear();
    } else {
      filtered.forEach(item => {
        state.selectedAssets.add(item.id || item.asset_id);
      });
    }
    updateSelectedCount();
    renderList();
  }

  function updateSelectedCount() {
    el('selectedCount').textContent = `Selected ${state.selectedAssets.size} items`;
  }

  async function batchDelete() {
    if (state.selectedAssets.size === 0) {
      showToast('Please select items to delete first', 'error');
      return;
    }
    if (!confirm(`Are you sure you want to delete ${state.selectedAssets.size} items?`)) return;

    const ids = Array.from(state.selectedAssets);
    let success = 0;
    for (const id of ids) {
      try {
        await api().delete(`/api/assets/${encodeURIComponent(id)}`);
        success++;
      } catch (error) {
        console.error('Delete error:', error);
      }
    }
    showToast(`Successfully deleted ${success} items`, 'success');
    toggleBatchMode(false);
    await refreshList();
  }

  // List Rendering
  async function refreshList() {
    // Check if API is configured before making request
    if (!state.apiBase) {
      console.warn('API Base URL not configured, skipping refresh');
      return;
    }

    try {
      const { data } = await api().get('/api/assets');
      state.assets = Array.isArray(data) ? data : (data.items || []);
      renderList();
    } catch (error) {
      console.error('Refresh error:', error);
      
      // Provide more specific error messages
      if (error.message && error.message.includes('API base URL is not set')) {
        showToast('Please configure API Base URL first', 'error');
        toggleConfigPanel(true);
      } else if (error.response) {
        // HTTP error response
        const status = error.response.status;
        if (status === 401) {
          showToast('Authentication failed, please check API Key', 'error');
        } else if (status === 404) {
          showToast('API endpoint not found, please check API Base URL', 'error');
        } else {
          showToast(`Failed to load: ${error.response.statusText || 'Server error'}`, 'error');
        }
      } else if (error.request) {
        // Network error or no response
        showToast('Cannot connect to server, please check API Base URL and network', 'error');
      } else {
        // Other errors
        showToast('Failed to load, please check configuration', 'error');
      }
    }
  }

  function filteredAndSorted() {
    let list = state.assets.slice();

    // Search filter
    if (state.search) {
      list = list.filter(x => {
        const name = (x.file_name || x.fileName || '').toLowerCase();
        const desc = (state.descriptions[x.id] || '').toLowerCase();
        const tags = (state.tags[x.id] || []).join(' ').toLowerCase();
        return name.includes(state.search) || desc.includes(state.search) || tags.includes(state.search);
      });
    }

    // Type filter
    if (state.filter !== 'all') {
      list = list.filter(x => {
        const type = x.file_type || x.fileType || '';
        if (state.filter === 'image') return type.startsWith('image/');
        if (state.filter === 'video') return type.startsWith('video/');
        if (state.filter === 'document') return !type.startsWith('image/') && !type.startsWith('video/');
        return true;
      });
    }

    // Sort
    const getName = (x) => (x.file_name || x.fileName || '').toLowerCase();
    const getCreated = (x) => new Date(x.created_at || x.createdAt || 0).getTime();
    const getSize = (x) => x.file_size || x.fileSize || 0;

    switch (state.sort) {
      case 'created_at_asc': list.sort((a, b) => getCreated(a) - getCreated(b)); break;
      case 'name_asc': list.sort((a, b) => getName(a).localeCompare(getName(b))); break;
      case 'name_desc': list.sort((a, b) => getName(b).localeCompare(getName(a))); break;
      case 'size_desc': list.sort((a, b) => getSize(b) - getSize(a)); break;
      case 'size_asc': list.sort((a, b) => getSize(a) - getSize(b)); break;
      case 'created_at_desc':
      default: list.sort((a, b) => getCreated(b) - getCreated(a));
    }

    return list;
  }

  function renderList() {
    const assetsRoot = el('assets');
    const list = filteredAndSorted();

    if (list.length === 0) {
      el('emptyState').style.display = 'block';
      assetsRoot.innerHTML = '';
      return;
    }

    el('emptyState').style.display = 'none';
    assetsRoot.className = state.view === 'grid' ? 'assets-grid' : 'assets-list';
    assetsRoot.innerHTML = '';

    list.forEach((item, index) => {
      const card = createAssetCard(item, index);
      assetsRoot.appendChild(card);
    });

    updateSelectedCount();
  }

  function createAssetCard(item, index) {
      const name = item.file_name || item.fileName || '(Untitled)';
      const size = item.file_size || item.fileSize;
      const created = item.created_at || item.createdAt;
      const blobUrl = item.blob_url || item.blobUrl;
    const id = item.id || item.asset_id;
    const type = item.file_type || item.fileType || '';
    const isImg = type.startsWith('image/') && blobUrl;
    const isVideo = type.startsWith('video/') && blobUrl;
    const isFavorite = state.favorites.includes(id);
    const isSelected = state.selectedAssets.has(id);

      const card = document.createElement('div');
    card.className = `asset-card ${state.view}-view`;
    card.dataset.id = id;
    card.dataset.index = index;

    // Batch selection checkbox
    const checkbox = document.createElement('div');
    checkbox.className = `card-batch-checkbox ${isSelected ? 'checked' : ''}`;
    checkbox.innerHTML = isSelected ? '✓' : '';
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (state.selectedAssets.has(id)) {
        state.selectedAssets.delete(id);
      } else {
        state.selectedAssets.add(id);
      }
      updateSelectedCount();
      renderList();
    };

    // Favorite button
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = `card-favorite ${isFavorite ? 'active' : ''}`;
    favoriteBtn.innerHTML = isFavorite ? '❤️' : '🤍';
    favoriteBtn.onclick = (e) => {
      e.stopPropagation();
      toggleFavorite(id);
    };

    // Image/Video
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.className = 'card-image';
    if (isImg || isVideo) {
      media.src = blobUrl;
      media.loading = 'lazy';
      if (isVideo) {
        media.controls = false;
        media.muted = true;
      }
    } else {
      const ext = name.split('.').pop()?.toUpperCase() || 'FILE';
      media.style.display = 'flex';
      media.style.alignItems = 'center';
      media.style.justifyContent = 'center';
      media.style.fontSize = '24px';
      media.style.background = 'var(--border-light)';
      media.textContent = ext;
    }

    // Overlay actions
    const overlay = document.createElement('div');
    overlay.className = 'card-overlay';
    overlay.innerHTML = `
      <div class="card-actions">
        <button class="card-action-btn" data-action="view">View</button>
        <button class="card-action-btn" data-action="edit">Edit</button>
        <button class="card-action-btn danger" data-action="delete">Delete</button>
          </div>
    `;

    // Info
    const info = document.createElement('div');
    info.className = 'card-info';
    info.innerHTML = `
      <div class="card-title" title="${name}">${name}</div>
      <div class="card-meta">
        <span>${fmtBytes(size)}</span>
        <span>·</span>
        <span>${formatDate(created)}</span>
        </div>
      `;

    card.appendChild(checkbox);
    card.appendChild(favoriteBtn);
    card.appendChild(media);
    card.appendChild(overlay);
    card.appendChild(info);

    // Click events
    card.addEventListener('click', (e) => {
      if (state.batchMode) {
        checkbox.click();
      } else if (!e.target.closest('.card-batch-checkbox') && !e.target.closest('.card-favorite') && !e.target.closest('.card-action-btn')) {
        openPreview(index);
      }
    });

    overlay.querySelectorAll('.card-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'view') openPreview(index);
        else if (action === 'edit') openEditModal(id);
        else if (action === 'delete') deleteAsset(id);
      });
    });

    return card;
  }

  // Favorite Functions
  function toggleFavorite(id) {
    const index = state.favorites.indexOf(id);
    if (index > -1) {
      state.favorites.splice(index, 1);
    } else {
      state.favorites.push(id);
    }
    localStorage.setItem('favorites', JSON.stringify(state.favorites));
    renderList();
  }

  // Preview Modal
  function setupModals() {
    // Close button
    qsAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });

    // Image preview navigation
    el('prevImage').addEventListener('click', () => navigatePreview(-1));
    el('nextImage').addEventListener('click', () => navigatePreview(1));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (el('imageModal').classList.contains('active')) {
        if (e.key === 'ArrowLeft') navigatePreview(-1);
        if (e.key === 'ArrowRight') navigatePreview(1);
        if (e.key === 'Escape') closeAllModals();
      }
    });

    // Preview actions
    el('favoriteBtn').addEventListener('click', () => {
      const id = getCurrentPreviewId();
      if (id) toggleFavorite(id);
      updatePreviewInfo();
    });

    el('shareBtn').addEventListener('click', shareAsset);
    el('downloadBtn').addEventListener('click', downloadAsset);
    el('editBtn').addEventListener('click', () => {
      const id = getCurrentPreviewId();
      if (id) openEditModal(id);
    });
    el('deleteBtn').addEventListener('click', () => {
      const id = getCurrentPreviewId();
      if (id) deleteAsset(id);
    });

    // Edit modal
    el('saveEdit').addEventListener('click', saveEdit);
    el('cancelEdit').addEventListener('click', () => closeAllModals());
  }

  function openPreview(index) {
    const list = filteredAndSorted();
    if (index < 0 || index >= list.length) return;

    state.currentPreviewIndex = index;
    const item = list[index];
    const blobUrl = item.blob_url || item.blobUrl;
    const type = item.file_type || item.fileType || '';

    if (type.startsWith('image/')) {
      el('previewImage').src = blobUrl;
      el('imageModal').classList.add('active');
      updatePreviewInfo();
    } else {
      showToast('Only images can be previewed', 'info');
    }
  }

  function navigatePreview(direction) {
    const list = filteredAndSorted().filter(item => {
      const type = item.file_type || item.fileType || '';
      return type.startsWith('image/');
    });
    if (list.length === 0) return;

    const currentItem = filteredAndSorted()[state.currentPreviewIndex];
    const currentId = currentItem?.id || currentItem?.asset_id;
    const currentIndex = list.findIndex(item => (item.id || item.asset_id) === currentId);
    
    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = list.length - 1;
    if (newIndex >= list.length) newIndex = 0;

    const newItem = list[newIndex];
    const newGlobalIndex = filteredAndSorted().findIndex(item => (item.id || item.asset_id) === (newItem.id || newItem.asset_id));
    state.currentPreviewIndex = newGlobalIndex;
    el('previewImage').src = newItem.blob_url || newItem.blobUrl;
    updatePreviewInfo();
  }

  function updatePreviewInfo() {
    const list = filteredAndSorted();
    if (state.currentPreviewIndex < 0 || state.currentPreviewIndex >= list.length) return;

    const item = list[state.currentPreviewIndex];
    const id = item.id || item.asset_id;
    const name = item.file_name || item.fileName || '(Untitled)';
    const size = item.file_size || item.fileSize;
    const created = item.created_at || item.createdAt;
    const type = item.file_type || item.fileType || '';
    const isFavorite = state.favorites.includes(id);

    el('previewTitle').textContent = name;
    el('previewSize').textContent = fmtBytes(size);
    el('previewDate').textContent = formatDate(created);
    el('previewType').textContent = type || 'Unknown';
    el('favoriteBtn').innerHTML = isFavorite ? '❤️' : '🤍';
  }

  function getCurrentPreviewId() {
    const list = filteredAndSorted();
    if (state.currentPreviewIndex < 0 || state.currentPreviewIndex >= list.length) return null;
    const item = list[state.currentPreviewIndex];
    return item.id || item.asset_id;
  }

  function closeAllModals() {
    qsAll('.modal').forEach(modal => modal.classList.remove('active'));
  }

  // Share Functions
  function shareAsset() {
    const list = filteredAndSorted();
    if (state.currentPreviewIndex < 0 || state.currentPreviewIndex >= list.length) return;

    const item = list[state.currentPreviewIndex];
    const blobUrl = item.blob_url || item.blobUrl;
    
    if (navigator.share) {
      navigator.share({
        title: item.file_name || item.fileName,
        url: blobUrl
      }).catch(() => copyToClipboard(blobUrl));
    } else {
      copyToClipboard(blobUrl);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Link copied to clipboard', 'success');
    }).catch(() => {
      showToast('Copy failed', 'error');
    });
  }

  // Download Functions
  function downloadAsset() {
    const list = filteredAndSorted();
    if (state.currentPreviewIndex < 0 || state.currentPreviewIndex >= list.length) return;

    const item = list[state.currentPreviewIndex];
    const blobUrl = item.blob_url || item.blobUrl;
    const name = item.file_name || item.fileName || 'download';

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    a.click();
    showToast('Download started', 'success');
  }

  // Edit Functions
  function openEditModal(id) {
    closeAllModals();
    const item = state.assets.find(a => (a.id || a.asset_id) === id);
    if (!item) return;

    el('editFileName').value = item.file_name || item.fileName || '';
    el('editDescription').value = state.descriptions[id] || '';
    el('editTags').value = (state.tags[id] || []).join(', ');
    el('editModal').dataset.id = id;
    el('editModal').classList.add('active');
  }

  function saveEdit() {
    const id = el('editModal').dataset.id;
    if (!id) return;

    const fileName = el('editFileName').value.trim();
    const description = el('editDescription').value.trim();
    const tags = el('editTags').value.split(',').map(t => t.trim()).filter(t => t);

    // Update local storage
    if (description) {
      state.descriptions[id] = description;
    } else {
      delete state.descriptions[id];
    }
    if (tags.length > 0) {
      state.tags[id] = tags;
    } else {
      delete state.tags[id];
    }
    localStorage.setItem('descriptions', JSON.stringify(state.descriptions));
    localStorage.setItem('tags', JSON.stringify(state.tags));

    // Update filename (if changed)
    if (fileName && fileName !== (state.assets.find(a => (a.id || a.asset_id) === id)?.file_name || state.assets.find(a => (a.id || a.asset_id) === id)?.fileName)) {
      api().put(`/api/assets/${encodeURIComponent(id)}`, { fileName }).catch(console.error);
    }

    showToast('Saved successfully', 'success');
    closeAllModals();
    refreshList();
  }

  // Delete Functions
  async function deleteAsset(id) {
    if (!confirm('Are you sure you want to delete this file?')) return;

    try {
      await api().delete(`/api/assets/${encodeURIComponent(id)}`);
      showToast('Deleted successfully', 'success');
      closeAllModals();
      await refreshList();
    } catch (error) {
      console.error('Delete error:', error);
      showToast('Delete failed', 'error');
    }
  }

  // Other Event Listeners
  function setupEventListeners() {
    // Upload button is already handled in setupUpload()
    // No need to add duplicate event listener
  }

  // Start - wait for DOM and libraries to be ready
  function startApp() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // Wait a bit for external scripts to load
        setTimeout(init, 100);
      });
    } else {
      // Wait a bit for external scripts to load
      setTimeout(init, 100);
    }
  }
  
  startApp();
})();
