(() => {
  const authView = document.getElementById('authView');
  const editorView = document.getElementById('editorView');
  const authForm = document.getElementById('authForm');
  const authMessage = document.getElementById('authMessage');
  const confirmWrap = document.getElementById('confirmPasswordWrap');
  const authSubmit = document.getElementById('authSubmit');
  const setupKeyWrap = document.getElementById('setupKeyWrap');
  const contentForm = document.getElementById('contentForm');
  const projectsEditor = document.getElementById('projectsEditor');
  const servicesEditor = document.getElementById('servicesEditor');
  const estimatorServicesEditor = document.getElementById('estimatorServicesEditor');
  const gradeImagesEditor = document.getElementById('gradeImagesEditor');
  const showreelVideoInput = document.getElementById('showreelVideoInput');
  const showreelThumbnailInput = document.getElementById('showreelThumbnailInput');
  const showreelAdminPreview = document.getElementById('showreelAdminPreview');
  const showreelThumbnailPreview = document.getElementById('showreelThumbnailPreview');
  const showreelVideoStatus = document.getElementById('showreelVideoStatus');
  const showreelThumbnailStatus = document.getElementById('showreelThumbnailStatus');
  const removeShowreelInput = document.getElementById('removeShowreelInput');
  const removeShowreelThumbnailInput = document.getElementById('removeShowreelThumbnailInput');
  const inquiriesEditor = document.getElementById('inquiriesEditor');
  let isSetup = false;
  let isVercelDeployment = false;
  let projects = [];
  let services = [];
  let estimatorServices = {};
  let gradeImageConfig = { beforeImage: '', gradeOptions: [] };
  let showreelVideoConfig = '';
  let showreelThumbnailConfig = '';
  const estimatorServiceDefaults = {
    youtube: { label: 'YouTube Long-Form / Documentary', billingUnit: 'minute', rateInr: 4500, extraMinuteRateInr: 350, defaultQuantity: 0, baseIncludes: 'Core editing, pacing, and one standard final export.', motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500 },
    reels: { label: 'Short-Form Reels / Shorts', billingUnit: 'video', rateInr: 5500, extraMinuteRateInr: 350, defaultQuantity: 1, baseIncludes: 'Core editing, pacing, and one standard final export.', motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500 },
    commercial: { label: 'Commercial / Brand Performance Ad', billingUnit: 'video', rateInr: 7500, extraMinuteRateInr: 350, defaultQuantity: 1, baseIncludes: 'Core editing, pacing, and one standard final export.', motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500 },
    music: { label: 'Cinematic Music Video + VFX', billingUnit: 'video', rateInr: 9000, extraMinuteRateInr: 350, defaultQuantity: 1, baseIncludes: 'Core editing, pacing, and one standard final export.', motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500 },
    wedding: { label: 'Wedding Highlight + Full Ceremony Film', billingUnit: 'video', rateInr: 12000, extraMinuteRateInr: 350, defaultQuantity: 1, baseIncludes: 'Core editing, pacing, and one standard final export.', motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500 }
  };

  async function api(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    } catch {
      throw new Error('Cannot reach the website server. Start start-portfolio.bat, then open http://127.0.0.1:5500/admin.html.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  function showEditor() { authView.classList.add('hidden'); editorView.classList.remove('hidden'); }
  function setMessage(element, text, error = false) { element.textContent = text; element.classList.toggle('error', error); }

  async function checkSession() {
    try {
      const status = await api('/api/admin/status');
      isVercelDeployment = status.storageMode === 'vercel';
      if (status.authenticated) { await loadContent(); showEditor(); return; }
      isSetup = !status.configured;
      document.getElementById('authTitle').textContent = isSetup ? 'Create your admin login' : 'Admin login';
      document.getElementById('authHint').textContent = isSetup ? 'Set your own username and a password with at least 12 characters. This happens once.' : 'Sign in to manage your portfolio content.';
      authSubmit.textContent = isSetup ? 'Create admin login' : 'Log in';
      confirmWrap.classList.toggle('hidden', !isSetup);
      setupKeyWrap.classList.toggle('hidden', !isSetup || !isVercelDeployment);
      authForm.elements.confirmPassword.required = isSetup;
      authForm.elements.setupKey.required = isSetup && isVercelDeployment;
      authForm.elements.password.autocomplete = isSetup ? 'new-password' : 'current-password';
    } catch (error) { setMessage(authMessage, error.message, true); }
  }
  authForm.addEventListener('submit', async event => {
    event.preventDefault(); setMessage(authMessage, '');
    const username = authForm.elements.username.value.trim();
    const password = authForm.elements.password.value;
    if (isSetup && password !== authForm.elements.confirmPassword.value) return setMessage(authMessage, 'The passwords do not match.', true);
    authSubmit.disabled = true;
    try {
      await api(isSetup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password, setupKey: authForm.elements.setupKey.value }) });
      await loadContent(); showEditor();
    } catch (error) { setMessage(authMessage, error.message, true); }
    finally { authSubmit.disabled = false; }
  });

  const textFields = ['brandName', 'role', 'availability', 'heroTitle', 'heroDescription', 'email', 'contactHeading', 'contactIntro', 'contactEyebrow', 'contactDirectLabel', 'copyEmailLabel', 'contactWorkflowTitle', 'contactWorkflowDetails', 'contactFormTitle', 'contactFormBadge', 'contactSubmitLabel', 'contactPrivacyNote', 'servicesHeading', 'servicesIntro'];
  function field(label, name, value, multiline = false, required = true, type = 'text') {
    const wrapper = document.createElement('label'); wrapper.className = 'project-field'; wrapper.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input'); input.name = name; input.value = value || ''; input.required = required;
    if (!multiline) input.type = type;
    if (multiline) input.rows = 3; wrapper.append(input); return wrapper;
  }
  function renderProjects() {
    projectsEditor.replaceChildren();
    projects.forEach((project, index) => {
      const card = document.createElement('article'); card.className = 'project-card';
      card.dataset.projectId = project.id;
      const heading = document.createElement('div'); heading.className = 'project-heading';
      const title = document.createElement('h3'); title.textContent = project.title || `Project ${index + 1}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { projects.splice(index, 1); renderProjects(); });
      heading.append(title, remove); card.append(heading);
      const grid = document.createElement('div'); grid.className = 'grid';
      const category = document.createElement('label'); category.className = 'project-field'; category.append(document.createTextNode('Category'));
      const categorySelect = document.createElement('select'); categorySelect.name = 'category';
      [['commercial', 'Commercial'], ['youtube', 'YouTube'], ['music', 'Music'], ['wedding', 'Wedding']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; categorySelect.append(option); });
      categorySelect.value = ['commercial', 'youtube', 'music', 'wedding'].includes(project.category) ? project.category : 'commercial'; category.append(categorySelect);
      const viewsField = document.createElement('label'); viewsField.className = 'project-field'; viewsField.append(document.createTextNode('Views level'));
      const viewsSelect = document.createElement('select'); viewsSelect.name = 'views';
      const viewLevels = [['', 'Not shown'], ['Under 1K Views', 'Under 1K Views'], ['1K+ Views', '1K+ Views'], ['5K+ Views', '5K+ Views'], ['10K+ Views', '10K+ Views'], ['50K+ Views', '50K+ Views'], ['100K+ Views', '100K+ Views'], ['500K+ Views', '500K+ Views'], ['1M+ Views', '1M+ Views'], ['5M+ Views', '5M+ Views'], ['10M+ Views', '10M+ Views'], ['50M+ Views', '50M+ Views'], ['100M+ Views', '100M+ Views']];
      viewLevels.forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; viewsSelect.append(option); });
      const parsedViews = Number(String(project.views || '').replace(/,/g, '').match(/[\d.]+/)?.[0] || 0) * (/m/i.test(project.views || '') ? 1000000 : /k/i.test(project.views || '') ? 1000 : 1);
      const selectedViewLevel = parsedViews >= 100000000 ? '100M+ Views' : parsedViews >= 50000000 ? '50M+ Views' : parsedViews >= 10000000 ? '10M+ Views' : parsedViews >= 5000000 ? '5M+ Views' : parsedViews >= 1000000 ? '1M+ Views' : parsedViews >= 500000 ? '500K+ Views' : parsedViews >= 100000 ? '100K+ Views' : parsedViews >= 50000 ? '50K+ Views' : parsedViews >= 10000 ? '10K+ Views' : parsedViews >= 5000 ? '5K+ Views' : parsedViews >= 1000 ? '1K+ Views' : parsedViews > 0 ? 'Under 1K Views' : '';
      viewsSelect.value = selectedViewLevel; viewsField.append(viewsSelect);
      const nameField = field('Project name', 'title', project.title);
      const videoField = field('YouTube or Vimeo URL (https)', 'videoUrl', project.videoUrl, false, false, 'url');
      const videoActions = document.createElement('div'); videoActions.className = 'project-video-actions';
      const fetchTitle = document.createElement('button'); fetchTitle.type = 'button'; fetchTitle.className = 'button secondary'; fetchTitle.textContent = 'Get video title';
      const videoStatus = document.createElement('span'); videoStatus.className = 'muted'; videoStatus.setAttribute('aria-live', 'polite');
      let isFetchingTitle = false;
      const fetchVideoTitle = async () => {
        if (isFetchingTitle) return;
        isFetchingTitle = true;
        fetchTitle.disabled = true; videoStatus.textContent = 'Fetching title…';
        try {
          const details = await api('/api/admin/video-metadata', { method: 'POST', body: JSON.stringify({ videoUrl: videoField.querySelector('input').value.trim() }) });
          nameField.querySelector('input').value = details.title;
          title.textContent = details.title;
          if (['commercial', 'youtube', 'music', 'wedding'].includes(details.category)) categorySelect.value = details.category;
          if (details.categoryLabel) card.querySelector('[name="categoryLabel"]').value = details.categoryLabel;
          videoStatus.textContent = details.message || 'Project name and suggested category filled from video. Enter duration and views manually.';
        } catch (error) { videoStatus.textContent = error.message; }
        finally { fetchTitle.disabled = false; isFetchingTitle = false; }
      };
      fetchTitle.addEventListener('click', fetchVideoTitle);
      videoField.querySelector('input').addEventListener('change', () => { if (videoField.querySelector('input').value.trim()) fetchVideoTitle(); });
      videoActions.append(fetchTitle, videoStatus);
      grid.append(nameField, category, field('Category label', 'categoryLabel', project.categoryLabel), viewsField, field('Duration', 'duration', project.duration), field('Tools used', 'tools', project.tools), videoField, videoActions, field('Description', 'desc', project.desc, true));
      card.append(grid); projectsEditor.append(card);
    });
    if (!projects.length) {
      const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No projects are published yet. Add real work and a public video link when you are ready.'; projectsEditor.append(empty);
    }
  }
  function renderGradeImages(preview = {}) {
    gradeImagesEditor.replaceChildren();
    gradeImageConfig = {
      beforeImage: preview.beforeImage || '',
      gradeOptions: Array.from({ length: 4 }, (_, index) => preview.gradeOptions?.[index] || { label: `Grade ${index + 1}`, imageUrl: '' })
    };
    const imageCards = [{ key: 'before', title: 'Before / ungraded image', label: '', imageUrl: gradeImageConfig.beforeImage },
      ...gradeImageConfig.gradeOptions.map((option, index) => ({ key: `grade-${index + 1}`, title: `Graded image ${index + 1}`, label: option.label, imageUrl: option.imageUrl }))];
    imageCards.forEach(item => {
      const card = document.createElement('article'); card.className = 'project-card grade-image-card'; card.dataset.imageKey = item.key;
      const heading = document.createElement('div'); heading.className = 'project-heading';
      const title = document.createElement('h3'); title.textContent = item.title; heading.append(title); card.append(heading);
      const grid = document.createElement('div'); grid.className = 'grid';
      if (item.key !== 'before') grid.append(field('Name shown on website', `gradeLabel_${item.key}`, item.label || item.title, false, true));
      const fileField = document.createElement('label'); fileField.className = 'project-field'; fileField.append(document.createTextNode(`${item.imageUrl ? 'Change saved image' : 'Choose image'} (JPG, PNG, or WebP; max 10 MB)`));
      const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/jpeg,image/png,image/webp'; fileInput.dataset.imageFile = 'true'; fileField.append(fileInput); grid.append(fileField);
      if (item.imageUrl) {
        const removeLabel = document.createElement('label'); removeLabel.className = 'toggle-row';
        const remove = document.createElement('input'); remove.type = 'checkbox'; remove.dataset.removeImage = 'true';
        removeLabel.append(remove, document.createTextNode('Remove saved image')); grid.append(removeLabel);
      }
      const preview = document.createElement('img'); preview.className = `grade-image-preview${item.imageUrl ? '' : ' hidden'}`; preview.alt = `${item.title} preview`; preview.src = item.imageUrl || '';
      const empty = document.createElement('p'); empty.className = `muted image-empty${item.imageUrl ? ' hidden' : ''}`; empty.textContent = 'No image uploaded yet.';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file && file.size <= 10 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          const removeSavedImage = card.querySelector('[data-remove-image]');
          if (removeSavedImage) removeSavedImage.checked = false;
          preview.src = URL.createObjectURL(file); preview.classList.remove('hidden'); empty.classList.add('hidden');
        } else if (file) { fileInput.value = ''; setMessage(document.getElementById('saveMessage'), 'Choose a JPG, PNG, or WebP image no larger than 10 MB.', true); }
      });
      card.append(grid, preview, empty); gradeImagesEditor.append(card);
    });
  }
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }
  async function uploadVercelFile(file, assetKey, onProgress = () => {}) {
    const started = await api('/api/admin/uploads/start', {
      method: 'POST',
      body: JSON.stringify({ assetKey, filename: file.name, contentType: file.type, size: file.size })
    });
    const chunkSize = 4 * 1024 * 1024;
    const chunkCount = Math.ceil(file.size / chunkSize);
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      let response;
      try {
        response = await fetch(`/api/admin/uploads/${started.uploadId}/${index + 1}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': file.type },
          body: file.slice(start, end)
        });
      } catch {
        throw new Error(`Upload connection interrupted while sending ${file.name}.`);
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Could not upload ${file.name}.`);
      onProgress(Math.round((end / file.size) * 100));
    }
    const completed = await api('/api/admin/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId: started.uploadId })
    });
    return completed.url;
  }
  function renderServices() {
    servicesEditor.replaceChildren();
    services.forEach((service, index) => {
      const card = document.createElement('article'); card.className = 'project-card';
      const title = document.createElement('h3'); title.className = 'project-heading'; title.textContent = `Service ${index + 1}`; card.append(title);
      const grid = document.createElement('div'); grid.className = 'grid';
      grid.append(field('Service title', 'title', service.title), field('Button label', 'buttonLabel', service.buttonLabel), field('Description', 'description', service.description, true));
      card.append(grid); servicesEditor.append(card);
    });
  }
  function renderEstimatorServices() {
    estimatorServicesEditor.replaceChildren();
    Object.entries(estimatorServices).forEach(([type, config]) => {
      const card = document.createElement('article'); card.className = 'project-card'; card.dataset.estimatorService = type;
      const heading = document.createElement('div'); heading.className = 'project-heading';
      const title = document.createElement('h3'); title.textContent = config.label || type; heading.append(title); card.append(heading);
      const grid = document.createElement('div'); grid.className = 'grid';
      const add = (key, label, value, inputType = 'number') => {
        const wrapper = field(label, `estimator_${type}_${key}`, value, false, true, inputType);
        wrapper.dataset.estimatorFieldWrapper = key;
        const input = wrapper.querySelector('input'); input.dataset.estimatorField = key;
        if (inputType === 'number') { input.min = key === 'defaultQuantity' ? '1' : '0'; input.max = key === 'defaultQuantity' ? '30' : '10000000'; input.step = '1'; }
        else input.maxLength = 100;
        grid.append(wrapper);
      };
      const unitWrapper = document.createElement('label'); unitWrapper.className = 'project-field'; unitWrapper.dataset.estimatorFieldWrapper = 'billingUnit'; unitWrapper.append(document.createTextNode('Billing basis'));
      const unitSelect = document.createElement('select'); unitSelect.name = `estimator_${type}_billingUnit`; unitSelect.dataset.estimatorField = 'billingUnit'; unitSelect.className = 'estimator-unit-select';
      [['minute', 'Per minute'], ['video', 'Per video']].forEach(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; unitSelect.append(option);
      });
      unitSelect.value = config.billingUnit === 'video' ? 'video' : 'minute'; unitWrapper.append(unitSelect); grid.append(unitWrapper);
      add('label', 'Service name in estimator', config.label, 'text');
      add('rateInr', 'Service rate (INR)', config.rateInr);
      add('extraMinuteRateInr', 'Each added minute (INR)', config.extraMinuteRateInr);
      const includes = field('What the base project includes', `estimator_${type}_baseIncludes`, config.baseIncludes || '', true, false);
      includes.dataset.estimatorFieldWrapper = 'baseIncludes';
      includes.querySelector('textarea').dataset.estimatorField = 'baseIncludes';
      includes.querySelector('textarea').placeholder = 'Describe the work included in the base project';
      grid.append(includes);
      add('defaultQuantity', 'Default number of videos', config.defaultQuantity);
      add('motionInr', 'Motion graphics add-on (INR)', config.motionInr);
      add('colorInr', 'Color grading add-on (INR)', config.colorInr);
      add('soundInr', 'Sound design add-on (INR)', config.soundInr);
      add('rushInr', 'Rush delivery add-on (INR)', config.rushInr);
      card.append(grid);
      const updateUnitFields = () => {
        const isVideo = unitSelect.value === 'video';
        const setLabel = (key, text) => { const wrapper = card.querySelector(`[data-estimator-field-wrapper="${key}"]`); wrapper.firstChild.textContent = text; };
        const minuteRate = card.querySelector('[data-estimator-field-wrapper="extraMinuteRateInr"]');
        const videoCount = card.querySelector('[data-estimator-field-wrapper="defaultQuantity"]');
        minuteRate.classList.toggle('hidden', isVideo);
        minuteRate.querySelector('input').disabled = isVideo;
        videoCount.classList.toggle('hidden', !isVideo);
        videoCount.querySelector('input').disabled = !isVideo;
        setLabel('rateInr', isVideo ? 'Rate per video (INR)' : 'Base fee per project (INR)');
        setLabel('baseIncludes', isVideo ? 'What each video rate includes' : 'What the base project includes');
        setLabel('extraMinuteRateInr', 'Each added minute (INR)');
        setLabel('defaultQuantity', 'Default number of videos');
        setLabel('motionInr', isVideo ? 'Motion graphics add-on per video (INR)' : 'Motion graphics add-on per project (INR)');
        setLabel('colorInr', isVideo ? 'Color grading add-on per video (INR)' : 'Color grading add-on per project (INR)');
        setLabel('soundInr', isVideo ? 'Sound design add-on per video (INR)' : 'Sound design add-on per project (INR)');
        setLabel('rushInr', isVideo ? 'Rush delivery add-on per video (INR)' : 'Rush delivery add-on per project (INR)');
      };
      unitSelect.addEventListener('change', () => {
        card.querySelector('[data-estimator-field="defaultQuantity"]').value = unitSelect.value === 'video' ? 1 : 0;
        updateUnitFields();
      });
      updateUnitFields();
      estimatorServicesEditor.append(card);
    });
  }
  async function loadContent() {
    const data = await api('/api/admin/content');
    textFields.forEach(key => { if (contentForm.elements[key]) contentForm.elements[key].value = data[key] || ''; });
    showreelVideoConfig = data.showreelVideo || '';
    contentForm.elements.showreelYoutubeUrl.value = data.showreelYoutubeUrl || '';
    showreelThumbnailConfig = data.showreelThumbnail || '';
    showreelVideoInput.value = '';
    showreelThumbnailInput.value = '';
    removeShowreelInput.checked = false;
    removeShowreelThumbnailInput.checked = false;
    showreelAdminPreview.classList.toggle('hidden', !showreelVideoConfig);
    if (showreelVideoConfig) showreelAdminPreview.src = showreelVideoConfig;
    else showreelAdminPreview.removeAttribute('src');
    showreelAdminPreview.poster = showreelThumbnailConfig;
    showreelThumbnailPreview.classList.toggle('hidden', !showreelThumbnailConfig);
    if (showreelThumbnailConfig) showreelThumbnailPreview.src = showreelThumbnailConfig;
    else showreelThumbnailPreview.removeAttribute('src');
    document.getElementById('removeShowreelThumbnailWrap').classList.toggle('hidden', !showreelThumbnailConfig);
    showreelThumbnailStatus.textContent = showreelThumbnailConfig ? 'Saved thumbnail. Select a new image to replace it.' : 'This image appears before the showreel starts.';
    document.getElementById('removeShowreelWrap').classList.toggle('hidden', !showreelVideoConfig);
    showreelVideoStatus.textContent = showreelVideoConfig ? 'Saved showreel video. Select a new file to replace it.' : 'No local showreel uploaded. Leave empty to use the animated preview.';
    const preview = data.colorPreview || {};
    for (const [key, fallback] of Object.entries({ colorPreviewEyebrow: 'Illustrative Color Demo', colorPreviewTitle: 'Interactive Color Look Preview', colorPreviewDescription: 'This interactive color-look demo is illustrative artwork, not a before-and-after from a client project.', colorPreviewBeforeLabel: 'FLAT S-LOG3 RAW', colorPreviewAfterLabel: 'RANA MASTER GRADE', colorPreviewSplit: 55, colorPreviewNodeTree: 'NODE_TREE: CST → EXPOSURE → SKIN_TONE_QUALIFIER → FILM_PRINT' })) contentForm.elements[key].value = preview[key.replace('colorPreview', '').replace(/^./, char => char.toLowerCase())] ?? fallback;
    contentForm.elements.colorPreviewSplit.min = '0'; contentForm.elements.colorPreviewSplit.max = '100';
    renderGradeImages(preview);
    contentForm.elements.pricingEnabled.checked = Boolean(data.pricingEnabled);
    contentForm.elements.usdRate.value = data.pricing?.usdRate ?? 82;
    estimatorServices = Object.fromEntries(Object.entries(estimatorServiceDefaults).map(([key, fallback]) => {
      const current = data.pricing?.serviceRates?.[key] || {};
      const billingUnit = current.billingUnit === 'video' || current.billingUnit === 'minute' ? current.billingUnit : fallback.billingUnit;
      const legacyRate = billingUnit === 'video'
        ? current.rateInr ?? current.fixedRateInr ?? data.pricing?.baseRatesInr?.[key] ?? fallback.rateInr
        : current.rateInr !== undefined && current.extraMinuteRateInr !== undefined
          ? current.rateInr
          : current.fixedRateInr ?? data.pricing?.baseRatesInr?.[key] ?? fallback.rateInr;
      return [key, {
        label: current.label || data.pricing?.typeLabels?.[key] || fallback.label,
        billingUnit,
        rateInr: legacyRate,
        baseIncludes: current.baseIncludes || fallback.baseIncludes || '',
        extraMinuteRateInr: current.extraMinuteRateInr ?? (billingUnit === 'minute' ? current.rateInr ?? data.pricing?.perMinuteInr : undefined) ?? fallback.extraMinuteRateInr,
        defaultQuantity: billingUnit === 'video' ? current.defaultVideos ?? current.defaultQuantity ?? 1 : 0,
        motionInr: current.motionInr ?? data.pricing?.motionInr ?? fallback.motionInr,
        colorInr: current.colorInr ?? data.pricing?.colorInr ?? fallback.colorInr,
        soundInr: current.soundInr ?? data.pricing?.soundInr ?? fallback.soundInr,
        rushInr: current.rushInr ?? data.pricing?.rushInr ?? fallback.rushInr
      }];
    }));
    renderEstimatorServices();
    projects = data.projects || []; renderProjects();
    services = data.services || []; renderServices();
    await loadInquiries();
  }
  async function loadInquiries() {
    const messages = await api('/api/admin/inquiries');
    inquiriesEditor.replaceChildren();
    if (!messages.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No project inquiries yet.'; inquiriesEditor.append(empty); return; }
    messages.forEach(item => {
      const card = document.createElement('article'); card.className = 'project-card';
      const heading = document.createElement('div'); heading.className = 'project-heading';
      const title = document.createElement('h3'); title.textContent = `${item.name} · ${item.project || 'Project inquiry'}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Delete';
      remove.addEventListener('click', async () => { if (confirm('Delete this inquiry permanently?')) { try { await api(`/api/admin/inquiries/${item.id}`, { method: 'DELETE' }); await loadInquiries(); } catch (error) { setMessage(document.getElementById('saveMessage'), error.message, true); } } });
      heading.append(title, remove);
      const date = document.createElement('p'); date.className = 'muted'; date.textContent = new Date(item.createdAt).toLocaleString();
      const email = document.createElement('a'); email.className = 'public-link'; email.href = `mailto:${item.email}`; email.textContent = item.email;
      const details = document.createElement('p'); details.className = 'muted'; details.textContent = `Budget: ${item.budget || 'Flexible'}`;
      const body = document.createElement('p'); body.className = 'inquiry-message'; body.textContent = item.message;
      card.append(heading, date, email, details, body);
      if (item.reference) { const link = document.createElement('a'); link.className = 'public-link'; link.href = item.reference; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open reference link ↗'; card.append(link); }
      inquiriesEditor.append(card);
    });
  }
  document.getElementById('addProjectBtn').addEventListener('click', () => {
    projects.push({ id: `project-${Date.now()}`, title: '', category: 'commercial', categoryLabel: 'Commercial Ad', views: '', viewsNum: 0, duration: '', tools: '', accent: '#0051ff', desc: '', thumbnailUrl: '', videoUrl: '' }); renderProjects();
    projectsEditor.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  showreelVideoInput.addEventListener('change', () => {
    const file = showreelVideoInput.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024 || !['video/mp4', 'video/webm'].includes(file.type)) {
      showreelVideoInput.value = '';
      setMessage(document.getElementById('saveMessage'), 'Choose an MP4 or WebM video no larger than 50 MB.', true);
      return;
    }
    removeShowreelInput.checked = false;
    showreelAdminPreview.src = URL.createObjectURL(file);
    showreelAdminPreview.classList.remove('hidden');
    document.getElementById('removeShowreelWrap').classList.toggle('hidden', !showreelVideoConfig);
    showreelVideoStatus.textContent = 'New video selected. Save changes to replace the saved showreel.';
  });
  showreelThumbnailInput.addEventListener('change', () => {
    const file = showreelThumbnailInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showreelThumbnailInput.value = '';
      setMessage(document.getElementById('saveMessage'), 'Choose a JPG, PNG, or WebP thumbnail no larger than 10 MB.', true);
      return;
    }
    removeShowreelThumbnailInput.checked = false;
    showreelThumbnailPreview.src = URL.createObjectURL(file);
    showreelThumbnailPreview.classList.remove('hidden');
    showreelThumbnailStatus.textContent = 'New thumbnail selected. Save changes to replace the saved image.';
    document.getElementById('removeShowreelThumbnailWrap').classList.toggle('hidden', !showreelThumbnailConfig);
    showreelAdminPreview.poster = showreelThumbnailPreview.src;
  });
  contentForm.addEventListener('submit', async event => {
    event.preventDefault(); const saveBtn = document.getElementById('saveBtn'); const message = document.getElementById('saveMessage');
    saveBtn.disabled = true; setMessage(message, 'Saving…');
    const data = Object.fromEntries(textFields.map(key => [key, contentForm.elements[key].value.trim()]));
    data.showreelVideo = showreelVideoConfig;
    data.showreelYoutubeUrl = contentForm.elements.showreelYoutubeUrl.value.trim();
    data.showreelUpload = '';
    data.removeShowreel = removeShowreelInput.checked;
    data.showreelThumbnail = showreelThumbnailConfig;
    data.showreelThumbnailUpload = '';
    data.removeShowreelThumbnail = removeShowreelThumbnailInput.checked;
    const showreelFile = showreelVideoInput.files?.[0];
    if (showreelFile) {
      try {
        if (isVercelDeployment) data.showreelVideo = await uploadVercelFile(showreelFile, 'showreelVideo', percent => setMessage(message, `Uploading showreel… ${percent}%`));
        else data.showreelUpload = await readImageFile(showreelFile);
      }
      catch (error) { setMessage(message, error.message, true); saveBtn.disabled = false; return; }
    }
    const showreelThumbnailFile = showreelThumbnailInput.files?.[0];
    if (showreelThumbnailFile) {
      try {
        if (isVercelDeployment) data.showreelThumbnail = await uploadVercelFile(showreelThumbnailFile, 'showreelThumbnail', percent => setMessage(message, `Uploading thumbnail… ${percent}%`));
        else data.showreelThumbnailUpload = await readImageFile(showreelThumbnailFile);
      }
      catch (error) { setMessage(message, error.message, true); saveBtn.disabled = false; return; }
    }
    if (data.removeShowreel) {
      data.showreelThumbnail = '';
      data.showreelThumbnailUpload = '';
      data.removeShowreelThumbnail = true;
    }
    data.colorPreview = {
      eyebrow: contentForm.elements.colorPreviewEyebrow.value.trim(),
      title: contentForm.elements.colorPreviewTitle.value.trim(),
      description: contentForm.elements.colorPreviewDescription.value.trim(),
      beforeLabel: contentForm.elements.colorPreviewBeforeLabel.value.trim(),
      afterLabel: contentForm.elements.colorPreviewAfterLabel.value.trim(),
      split: Number(contentForm.elements.colorPreviewSplit.value),
      nodeTree: contentForm.elements.colorPreviewNodeTree.value.trim(),
      beforeImage: gradeImageConfig.beforeImage,
      gradeOptions: gradeImageConfig.gradeOptions.map((option, index) => ({ label: contentForm.elements[`gradeLabel_grade-${index + 1}`].value.trim(), imageUrl: option.imageUrl || '' })),
      uploads: {},
      removeImages: []
    };
    for (const card of gradeImagesEditor.querySelectorAll('.grade-image-card')) {
      const key = card.dataset.imageKey;
      const file = card.querySelector('[data-image-file]')?.files?.[0];
      if (file) {
        if (file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setMessage(message, 'Each image must be JPG, PNG, or WebP and no larger than 10 MB.', true); saveBtn.disabled = false; return; }
        try {
          if (isVercelDeployment) {
            const uploadedUrl = await uploadVercelFile(file, `colorPreview:${key}`, percent => setMessage(message, `Uploading ${key}… ${percent}%`));
            if (key === 'before') data.colorPreview.beforeImage = uploadedUrl;
            else data.colorPreview.gradeOptions[Number(key.split('-')[1]) - 1].imageUrl = uploadedUrl;
          } else data.colorPreview.uploads[key] = await readImageFile(file);
        }
        catch (error) { setMessage(message, error.message, true); saveBtn.disabled = false; return; }
      }
      if (card.querySelector('[data-remove-image]')?.checked) data.colorPreview.removeImages.push(key);
    }
    data.pricingEnabled = contentForm.elements.pricingEnabled.checked;
    const serviceRates = Object.fromEntries([...estimatorServicesEditor.querySelectorAll('.project-card')].map(card => {
      const config = Object.fromEntries([...card.querySelectorAll('[data-estimator-field]')].map(input => [
        input.dataset.estimatorField,
        input.type === 'number' ? Number(input.value) : input.value.trim()
      ]));
      config.billingUnit = card.querySelector('[data-estimator-field="billingUnit"]').value;
      if (config.billingUnit === 'video') delete config.extraMinuteRateInr;
      else delete config.defaultQuantity;
      return [card.dataset.estimatorService, config];
    }));
    data.pricing = {
      usdRate: Number(contentForm.elements.usdRate.value),
      serviceRates,
      baseRatesInr: Object.fromEntries(Object.entries(serviceRates).map(([key, config]) => [key, config.rateInr])),
      perMinuteInr: serviceRates.youtube.extraMinuteRateInr ?? Object.values(serviceRates).find(config => config.extraMinuteRateInr !== undefined)?.extraMinuteRateInr ?? 0,
      motionInr: serviceRates.youtube.motionInr,
      colorInr: serviceRates.youtube.colorInr,
      soundInr: serviceRates.youtube.soundInr,
      rushInr: serviceRates.youtube.rushInr,
      typeLabels: Object.fromEntries(Object.entries(serviceRates).map(([key, config]) => [key, config.label]))
    };
    data.services = [...servicesEditor.querySelectorAll('.project-card')].map(card => Object.fromEntries([...card.querySelectorAll('[name]')].map(input => [input.name, input.value.trim()])));
    const parseViews = value => {
      const match = String(value).replace(/,/g, '').match(/([\d.]+)\s*(m|k)?/i);
      if (!match) return 0;
      return Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1);
    };
    data.projects = [...projectsEditor.querySelectorAll('.project-card')].map((card, index) => {
      const values = Object.fromEntries([...card.querySelectorAll('[name]')].map(input => [input.name, input.value.trim()]));
      const original = projects.find(project => project.id === card.dataset.projectId) || {};
      return { ...original, ...values, id: original.id || `project-${Date.now()}-${index}`, viewsNum: parseViews(values.views) };
    });
    try {
      await api('/api/admin/content', { method: 'PUT', body: JSON.stringify(data) });
      await loadContent();
      try { localStorage.setItem('rm-edits-content-updated', String(Date.now())); } catch {}
      setMessage(message, 'Saved. Your public portfolio will use these updates.');
    }
    catch (error) { setMessage(message, error.message, true); }
    finally { saveBtn.disabled = false; }
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); location.reload(); }
    catch (error) { const message = document.getElementById('saveMessage'); setMessage(message, error.message, true); }
  });
  document.getElementById('refreshInquiriesBtn').addEventListener('click', async () => {
    try { await loadInquiries(); }
    catch (error) { setMessage(document.getElementById('saveMessage'), error.message, true); }
  });
  const adminSectionLinks = [...document.querySelectorAll('.admin-section-nav a, .dashboard-shortcuts a')];
  adminSectionLinks.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    history.replaceState(null, '', link.getAttribute('href'));
    document.querySelectorAll('.admin-section-nav a').forEach(sideLink => {
      if (sideLink.hash === link.hash) sideLink.setAttribute('aria-current', 'location');
      else sideLink.removeAttribute('aria-current');
    });
    requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }));
  checkSession();
})();


(() => {
  let nextId = 0;

  function enhance(select) {
    if (select.dataset.animatedDropdown === 'true') return;
    select.dataset.animatedDropdown = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'animated-select';
    wrapper.style.width = select.classList.contains('w-full') || select.closest('.project-field, .grid') ? '100%' : `${Math.max(select.getBoundingClientRect().width, 150)}px`;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select);

    const id = `animated-select-${++nextId}`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `animated-select-trigger ${select.className}`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-list`);
    const associatedLabel = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || associatedLabel?.textContent?.trim() || select.closest('label')?.childNodes[0]?.textContent?.trim() || 'Choose an option');
    const valueText = document.createElement('span');
    valueText.className = 'animated-select-value';
    const caret = document.createElement('span');
    caret.className = 'animated-select-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '⌄';
    trigger.append(valueText, caret);

    const menu = document.createElement('div');
    menu.id = `${id}-list`;
    menu.className = 'animated-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    wrapper.append(trigger, menu);
    select.classList.add('animated-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    function refresh() {
      const selected = select.options[select.selectedIndex];
      valueText.textContent = selected?.textContent?.trim() || 'Choose an option';
      menu.replaceChildren();
      [...select.options].forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'animated-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.disabled = option.disabled;
        item.textContent = option.textContent.trim();
        item.addEventListener('click', () => {
          select.selectedIndex = index;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          refresh();
          close();
          trigger.focus();
        });
        menu.append(item);
      });
    }
    function open() {
      refresh();
      const spaceBelow = window.innerHeight - wrapper.getBoundingClientRect().bottom;
      const spaceAbove = wrapper.getBoundingClientRect().top;
      menu.classList.toggle('opens-up', spaceBelow < 220 && spaceAbove > spaceBelow);
      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      const active = menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector('button:not(:disabled)');
      active?.focus({ preventScroll: true });
    }
    function close() {
      wrapper.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', () => wrapper.classList.contains('is-open') ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!wrapper.classList.contains('is-open')) open();
      }
    });
    menu.addEventListener('keydown', event => {
      const options = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
      } else if (event.key === 'Home') { event.preventDefault(); options[0]?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); options.at(-1)?.focus(); }
    });
    select.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true });
    refresh();
  }

  function enhanceAll(root = document) { root.querySelectorAll('select').forEach(enhance); }
  enhanceAll();
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) {
        if (node.matches?.('select')) enhance(node);
        enhanceAll(node);
      }
    }));
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    document.querySelectorAll('.animated-select.is-open').forEach(wrapper => {
      if (!wrapper.contains(event.target)) {
        wrapper.classList.remove('is-open');
        wrapper.querySelector('.animated-select-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });
  });
})();
