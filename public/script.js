(function () {
      window.addEventListener('storage', event => {
        if (event.key === 'rm-edits-content-updated') window.location.reload();
      });

      // --- PORTFOLIO DATA ---
      let portfolioProjects = [];

      // --- STATE ---
      let activeCategory = 'all';
      let searchQuery = '';
      let sortBy = 'featured';
      let savedIds = {};
      try {
        const rawSaved = localStorage.getItem('rana_saved_projects');
        if (rawSaved) savedIds = JSON.parse(rawSaved);
      } catch (e) {
        savedIds = {};
      }

      // Demo-only list: inquiries are not transmitted or stored by this static page.
      // --- TOAST HELPER ---
      function showToast(msg) {
        const toast = document.getElementById('toastNotification');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => {
          toast.classList.add('hidden');
        }, 3200);
      }

      // --- MOBILE MENU ---
      const mobileMenuBtn = document.getElementById('mobileMenuBtn');
      const mobileMenuPanel = document.getElementById('mobileMenuPanel');
      mobileMenuBtn.addEventListener('click', () => {
        const isOpen = mobileMenuPanel.classList.toggle('is-open');
        mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
      });
      document.querySelectorAll('.mobile-nav-link').forEach((link) => {
        link.addEventListener('click', () => { mobileMenuPanel.classList.remove('is-open'); mobileMenuBtn.setAttribute('aria-expanded', 'false'); });
      });

      // --- SHOWREEL CANVAS PLAYER ---
      const showreelCanvas = document.getElementById('showreelCanvas');
      const rCtx = showreelCanvas.getContext('2d');
      let reelPlaying = false;
      let reelProgress = 0;
      let activeScene = 0;
      let synthEnabled = false;
      let audioCtx = null;

      const sceneConfigs = [
        { name: 'PREVIEW 01: COMMERCIAL', primary: '#f59e0b', secondary: '#06b6d4', title: 'COMMERCIAL CUT STUDY' },
        { name: 'PREVIEW 02: DOCUMENTARY', primary: '#06b6d4', secondary: '#10b981', title: 'DOCUMENTARY PACING STUDY' },
        { name: 'PREVIEW 03: MOTION DESIGN', primary: '#f43f5e', secondary: '#a855f7', title: 'MOTION DESIGN STUDY' },
        { name: 'PREVIEW 04: WEDDING FILM', primary: '#fbbf24', secondary: '#fb7185', title: 'WEDDING FILM STUDY' }
      ];

      function triggerBeatPulse() {
        if (!synthEnabled) return;
        try {
          if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
          }
          if (audioCtx.state === 'suspended') audioCtx.resume();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(95, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(38, audioCtx.currentTime + 0.14);
          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.16);
        } catch (e) {}
      }

      let lastBeatTick = 0;
      function drawShowreelFrame(timestamp) {
        if (reelPlaying) {
          reelProgress = (reelProgress + 0.18) % 100;
          document.getElementById('reelScrubber').value = Math.floor(reelProgress);
          if (timestamp - lastBeatTick > 650) {
            lastBeatTick = timestamp;
            triggerBeatPulse();
          }
        }

        const cfg = sceneConfigs[activeScene];
        const w = showreelCanvas.width;
        const h = showreelCanvas.height;

        // Background gradient
        const grad = rCtx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#07090f');
        grad.addColorStop(0.5, '#111827');
        grad.addColorStop(1, '#090d16');
        rCtx.fillStyle = grad;
        rCtx.fillRect(0, 0, w, h);

        // Animated perspective grid & cinema light beams
        const t = reelProgress * 0.12;
        rCtx.strokeStyle = cfg.primary + '33';
        rCtx.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
          const x = ((i * 60 + t * 25) % w);
          rCtx.beginPath();
          rCtx.moveTo(x, 0);
          rCtx.lineTo(w / 2 + (x - w / 2) * 1.8, h);
          rCtx.stroke();
        }

        // Dynamic glowing orb / lens flare
        const orbX = w * 0.5 + Math.sin(t) * 110;
        const orbY = h * 0.45 + Math.cos(t * 0.8) * 35;
        const rad = rCtx.createRadialGradient(orbX, orbY, 8, orbX, orbY, 160);
        rad.addColorStop(0, cfg.primary + 'cc');
        rad.addColorStop(0.45, cfg.secondary + '44');
        rad.addColorStop(1, 'transparent');
        rCtx.fillStyle = rad;
        rCtx.fillRect(0, 0, w, h);

        // Center Typography Frame
        rCtx.fillStyle = '#ffffff';
        rCtx.font = '900 24px Inter, sans-serif';
        rCtx.textAlign = 'center';
        rCtx.fillText('ILLUSTRATIVE PREVIEW', w / 2, h / 2 - 10);

        rCtx.fillStyle = cfg.primary;
        rCtx.font = '600 13px "JetBrains Mono", monospace';
        rCtx.fillText(cfg.title, w / 2, h / 2 + 16);

        // Bottom Audio Waveform bars
        const barCount = 38;
        const barWidth = (w - 120) / barCount;
        for (let i = 0; i < barCount; i++) {
          const amp = Math.abs(Math.sin(t * 2 + i * 0.45)) * 28 + 4;
          rCtx.fillStyle = i % 2 === 0 ? cfg.primary : cfg.secondary;
          rCtx.fillRect(60 + i * barWidth, h - 42 - amp, barWidth - 3, amp);
        }

        if (reelPlaying) requestAnimationFrame(drawShowreelFrame);
      }
      requestAnimationFrame(drawShowreelFrame);

      document.getElementById('reelPlayPauseBtn').addEventListener('click', () => {
        reelPlaying = !reelPlaying;
        document.getElementById('reelPlayPauseLabel').textContent = reelPlaying ? 'Pause preview' : 'Play preview';
        if (reelPlaying) requestAnimationFrame(drawShowreelFrame);
      });
      document.getElementById('reelScrubber').addEventListener('input', (e) => {
        reelProgress = Number(e.target.value);
        if (!reelPlaying) drawShowreelFrame(performance.now());
      });
      document.getElementById('reelAudioBtn').addEventListener('click', (e) => {
        synthEnabled = !synthEnabled;
        e.currentTarget.textContent = synthEnabled ? '🔊 Synth Beat: ON' : '🔇 Synth Beat: OFF';
        if (synthEnabled) triggerBeatPulse();
      });

      document.querySelectorAll('.reel-scene-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeScene = Number(btn.getAttribute('data-scene'));
          document.getElementById('reelSceneBadge').textContent = sceneConfigs[activeScene].name;
          document.querySelectorAll('.reel-scene-btn').forEach((b) => {
            b.className = 'reel-scene-btn px-2.5 py-1.5 rounded-lg text-xs font-mono border border-slate-800 bg-slate-900/90 text-slate-400 hover:text-white text-left truncate';
          });
          btn.className = 'reel-scene-btn px-2.5 py-1.5 rounded-lg text-xs font-mono border border-amber-500 bg-amber-500/15 text-amber-300 text-left truncate';
        });
      });

      // --- RENDER PORTFOLIO GRID ---
      const portfolioGrid = document.getElementById('portfolioGrid');

      function getProjectThumbnailUrl(project) {
        if (project.thumbnailUrl && /^(https:\/\/|\/)/i.test(project.thumbnailUrl)) return project.thumbnailUrl;
        if (!project.videoUrl) return '';
        try {
          const video = new URL(project.videoUrl);
          let videoId = '';
          if (video.hostname === 'youtu.be') videoId = video.pathname.split('/').filter(Boolean)[0] || '';
          else if (/(^|\.)youtube(?:-nocookie)?\.com$/i.test(video.hostname)) {
            videoId = video.searchParams.get('v') || video.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] || '';
          }
          return /^[\w-]{11}$/.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
        } catch { return ''; }
      }

      function renderPortfolio() {
        let items = portfolioProjects.filter((p) => {
          const matchesCat = activeCategory === 'all' || p.category === activeCategory;
          const matchesSearch =
            p.title.toLowerCase().includes(searchQuery) ||
            p.tools.toLowerCase().includes(searchQuery) ||
            p.desc.toLowerCase().includes(searchQuery);
          const matchesSaved = sortBy === 'saved' ? Boolean(savedIds[p.id]) : true;
          return matchesCat && matchesSearch && matchesSaved;
        });

        if (sortBy === 'views') {
          items = [...items].sort((a, b) => b.viewsNum - a.viewsNum);
        }

        if (items.length === 0) {
          portfolioGrid.innerHTML = `
            <div class="col-span-full p-10 rounded-2xl bg-[#121621] border border-slate-800 text-center space-y-3">
              <div class="text-lg font-bold text-white">No matching edits found</div>
            <p class="text-sm text-slate-400">Rana is adding real project examples. Contact him to request relevant samples.</p>
            </div>
          `;
          return;
        }

        portfolioGrid.innerHTML = items
          .map((item) => {
            const isSaved = Boolean(savedIds[item.id]);
            const thumbnailUrl = escapeHtml(getProjectThumbnailUrl(item));
            return `
              <article class="rounded-2xl bg-[#121621] border border-slate-800 hover:border-amber-500/50 overflow-hidden flex flex-col justify-between transition-all group">
                <div>
                  <!-- Use the linked video's thumbnail when available, otherwise show generated artwork. -->
                  <div class="relative aspect-video bg-[#080a10] overflow-hidden border-b border-slate-800">
                    ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="${escapeHtml(item.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />` : `<svg class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" viewBox="0 0 400 225" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <linearGradient id="grad-${escapeHtml(item.id)}" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stop-color="#090d16" />
                          <stop offset="55%" stop-color="#151c2c" />
                          <stop offset="100%" stop-color="${escapeHtml(item.accent)}44" />
                        </linearGradient>
                      </defs>
                      <rect width="400" height="225" fill="url(#grad-${escapeHtml(item.id)})" />
                      <circle cx="310" cy="70" r="65" fill="${escapeHtml(item.accent)}22" />
                      <path d="M 0 185 Q 140 130 260 175 T 400 155 L 400 225 L 0 225 Z" fill="${escapeHtml(item.accent)}28" />
                      <!-- Play Icon Circle -->
                      <circle cx="200" cy="105" r="26" fill="#090b10cc" stroke="${escapeHtml(item.accent)}" stroke-width="2" />
                      <polygon points="195,94 195,116 213,105" fill="${escapeHtml(item.accent)}" />
                      <text x="16" y="205" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="10">PROJECT PREVIEW ARTWORK</text>
                    </svg>`}
                    <span class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/80 text-[11px] font-mono text-amber-400 border border-slate-700">
                      ${escapeHtml(item.categoryLabel)}
                    </span>
                    <span class="absolute bottom-3 right-3 px-2 py-0.5 rounded bg-black/80 text-[11px] font-mono text-white">
                      ${escapeHtml(item.duration)}
                    </span>
                  </div>

                  <!-- Content -->
                  <div class="p-5 space-y-2.5">
                    <div class="flex items-center justify-between text-xs font-mono text-slate-400">
                      <span class="text-emerald-400 font-semibold">${escapeHtml(item.views)}</span>
                      <button type="button" data-save-id="${escapeHtml(item.id)}" class="save-project-btn px-2 py-0.5 rounded border ${
                        isSaved
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                          : 'border-slate-700 bg-slate-800/70 text-slate-400 hover:text-white'
                      }">
                        ${isSaved ? '★ Saved' : '☆ Save'}
                      </button>
                    </div>
                    <h3 class="text-base sm:text-lg font-bold text-white leading-snug">${escapeHtml(item.title)}</h3>
                    <p class="text-xs sm:text-sm text-slate-400 line-clamp-2">${escapeHtml(item.desc)}</p>
                    <div class="pt-1 text-[11px] font-mono text-cyan-400">${escapeHtml(item.tools)}</div>
                  </div>
                </div>

                <div class="px-5 pb-5 pt-2">
                  <button type="button" data-open-id="${escapeHtml(item.id)}" class="open-project-btn w-full py-2.5 rounded-xl bg-slate-800 hover:bg-amber-500 hover:text-black text-white font-semibold text-xs sm:text-sm transition-all">
                    View Project Details
                  </button>
                </div>
              </article>
            `;
          })
          .join('');
      }

      renderPortfolio();

      // Delegate Save & Modal Open clicks on Portfolio Grid
      portfolioGrid.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('.save-project-btn');
        if (saveBtn) {
          const id = saveBtn.getAttribute('data-save-id');
          savedIds[id] = !savedIds[id];
          try {
            localStorage.setItem('rana_saved_projects', JSON.stringify(savedIds));
          } catch (err) {}
          renderPortfolio();
          showToast(savedIds[id] ? 'Added cut to your saved bookmarks' : 'Removed cut from bookmarks');
          return;
        }

        const openBtn = e.target.closest('.open-project-btn');
        if (openBtn) {
          const id = openBtn.getAttribute('data-open-id');
          const proj = portfolioProjects.find((p) => p.id === id);
          if (proj) openProjectModal(proj);
        }
      });

      // Portfolio Filter & Search Listeners
      document.querySelectorAll('.portfolio-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeCategory = btn.getAttribute('data-category');
          document.querySelectorAll('.portfolio-filter-btn').forEach((b) => {
            b.className = 'portfolio-filter-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#121621] text-slate-300 hover:text-white border border-slate-800 transition-all';
          });
          btn.className = 'portfolio-filter-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-500 text-black transition-all';
          renderPortfolio();
        });
      });

      document.getElementById('portfolioSearchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderPortfolio();
      });

      document.getElementById('portfolioSortSelect').addEventListener('change', (e) => {
        sortBy = e.target.value;
        renderPortfolio();
      });

      // --- PROJECT BREAKDOWN MODAL ---
      const projectModal = document.getElementById('projectModal');
      let activeModalProject = null;
      let projectModalOpener = null;

      function openProjectModal(proj) {
        projectModalOpener = document.activeElement;
        activeModalProject = proj;
        document.getElementById('modalProjectCategory').textContent = proj.categoryLabel;
        document.getElementById('modalProjectTitle').textContent = proj.title;
        document.getElementById('modalProjectStats').textContent = [proj.views, proj.duration].filter(Boolean).join(' • ');
        document.getElementById('modalProjectDesc').textContent = proj.desc;
        document.getElementById('modalProjectTools').textContent = proj.tools;
        const thumbnail = document.getElementById('modalProjectThumbnail');
        const projectThumbnailUrl = getProjectThumbnailUrl(proj);
        if (projectThumbnailUrl) {
          thumbnail.src = projectThumbnailUrl;
          thumbnail.alt = `${proj.title} video thumbnail`;
          thumbnail.classList.remove('hidden');
          document.getElementById('modalPreviewCanvas').classList.add('hidden');
        } else {
          thumbnail.removeAttribute('src');
          thumbnail.classList.add('hidden');
          document.getElementById('modalPreviewCanvas').classList.remove('hidden');
        }
        document.querySelector('#modalPreviewCanvas + div span')?.replaceChildren(document.createTextNode(thumbnail.classList.contains('hidden') ? 'ILLUSTRATIVE PREVIEW ARTWORK' : 'PROJECT THUMBNAIL'));
        const videoLink = document.getElementById('modalVideoLink');
        const videoNotice = document.getElementById('modalVideoNotice');
        if (proj.videoUrl && /^https:\/\//i.test(proj.videoUrl)) {
          videoLink.href = proj.videoUrl;
          videoLink.classList.remove('hidden');
          videoNotice.classList.add('hidden');
        } else {
          videoLink.removeAttribute('href');
          videoLink.classList.add('hidden');
          videoNotice.classList.remove('hidden');
        }
        projectModal.classList.remove('hidden');
        drawModalPreview(proj);
        document.getElementById('closeProjectModalBtn').focus();
      }

      function closeProjectModal() {
        projectModal.classList.add('hidden');
        if (projectModalOpener instanceof HTMLElement) projectModalOpener.focus();
      }

      function drawModalPreview(proj) {
        const c = document.getElementById('modalPreviewCanvas');
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, c.width, c.height);

        const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 10, c.width / 2, c.height / 2, 220);
        g.addColorStop(0, proj.accent + '99');
        g.addColorStop(1, '#090d16');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(proj.title, c.width / 2, c.height / 2 - 12);

        ctx.fillStyle = '#fbbf24';
        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.fillText('ILLUSTRATIVE PREVIEW ARTWORK', c.width / 2, c.height / 2 + 18);
      }

      document.getElementById('closeProjectModalBtn').addEventListener('click', () => {
        closeProjectModal();
      });

      projectModal.addEventListener('click', (event) => { if (event.target === projectModal) closeProjectModal(); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !projectModal.classList.contains('hidden')) closeProjectModal(); });

      document.getElementById('modalBookSimilarBtn').addEventListener('click', () => {
        closeProjectModal();
        if (activeModalProject) {
          document.getElementById('clientMessage').value = `Hi Rana, I loved your "${activeModalProject.title}" cut and would like a similar edit for my upcoming project.`;
        }
        document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
      });

      // --- INTERACTIVE BEFORE / AFTER COLOR GRADING CANVAS ---
      const colorGradeCanvas = document.getElementById('colorGradeCanvas');
      const cgCtx = colorGradeCanvas.getContext('2d');
      const colorGradeSlider = document.getElementById('colorGradeSlider');
      let currentGradeIndex = 0;
      let gradeImages = { before: null, graded: [null, null, null, null] };
      let gradeOptionLabels = ['Graded Image 1', 'Graded Image 2', 'Graded Image 3', 'Graded Image 4'];
      const fallbackGradeLooks = [
        { sky: '#083344', glow: '#f59e0b', hill: '#0f172a' },
        { sky: '#2e1065', glow: '#ec4899', hill: '#1e1b4b' },
        { sky: '#451a03', glow: '#fbbf24', hill: '#292524' },
        { sky: '#0c4a6e', glow: '#38bdf8', hill: '#0f172a' }
      ];
      function loadGradeImage(path) {
        const localImage = typeof path === 'string' && /^\/media\/color-preview-(?:before|grade-[1-4])\.(?:jpg|png|webp)$/.test(path);
        const blobImage = typeof path === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(path);
        if (!localImage && !blobImage) return null;
        const img = new Image();
        img.onload = renderColorGradeComparison;
        img.src = path;
        return img;
      }
      function drawCover(image) {
        const imageRatio = image.naturalWidth / image.naturalHeight;
        const canvasRatio = colorGradeCanvas.width / colorGradeCanvas.height;
        const sourceWidth = imageRatio > canvasRatio ? image.naturalHeight * canvasRatio : image.naturalWidth;
        const sourceHeight = imageRatio > canvasRatio ? image.naturalHeight : image.naturalWidth / canvasRatio;
        cgCtx.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, colorGradeCanvas.width, colorGradeCanvas.height);
      }

      function renderColorGradeComparison() {
        const dividerPct = Math.min(100, Math.max(0, Number(colorGradeSlider.value)));
        const gradedPct = 100 - dividerPct;
        document.getElementById('gradeSplitLabel').textContent = `${gradedPct}% GRADED`;
        document.getElementById('gradeBeforeLabel').classList.toggle('hidden', dividerPct < 18);
        document.getElementById('gradeAfterLabel').classList.toggle('hidden', gradedPct < 18);
        colorGradeCanvas.setAttribute('aria-valuenow', String(gradedPct));
        colorGradeCanvas.setAttribute('aria-valuetext', `${gradedPct} percent graded`);
        const w = colorGradeCanvas.width;
        const h = colorGradeCanvas.height;
        const splitX = (dividerPct / 100) * w;
        const look = fallbackGradeLooks[currentGradeIndex];
        const beforeImage = gradeImages.before;

        // 1. Draw the raw-looking source on the full canvas, or the generated fallback.
        if (beforeImage?.complete && beforeImage.naturalWidth) {
          cgCtx.save();
          cgCtx.filter = 'saturate(.45) contrast(.9) brightness(.88)';
          drawCover(beforeImage);
          cgCtx.restore();
        } else {
        cgCtx.fillStyle = '#525866';
        cgCtx.fillRect(0, 0, w, h);
        cgCtx.fillStyle = '#737b8c';
        cgCtx.beginPath();
        cgCtx.arc(w * 0.62, h * 0.38, 55, 0, Math.PI * 2);
        cgCtx.fill();
        cgCtx.fillStyle = '#3f4450';
        cgCtx.beginPath();
        cgCtx.moveTo(0, h);
        cgCtx.lineTo(w * 0.35, h * 0.52);
        cgCtx.lineTo(w * 0.72, h * 0.68);
        cgCtx.lineTo(w, h * 0.48);
        cgCtx.lineTo(w, h);
        cgCtx.fill();
        }

        // 2. Draw the selected graded image on the right side of the divider.
        cgCtx.save();
        cgCtx.beginPath();
        cgCtx.rect(splitX, 0, w - splitX, h);
        cgCtx.clip();

        const gradedImage = gradeImages.graded[currentGradeIndex];
        if (gradedImage?.complete && gradedImage.naturalWidth) {
          cgCtx.save();
          cgCtx.filter = 'saturate(1.35) contrast(1.08)';
          drawCover(gradedImage);
          cgCtx.restore();
        } else {
        const skyGrad = cgCtx.createLinearGradient(0, 0, 0, h);
        skyGrad.addColorStop(0, look.sky);
        skyGrad.addColorStop(1, '#090b10');
        cgCtx.fillStyle = skyGrad;
        cgCtx.fillRect(0, 0, w, h);

        const sunGrad = cgCtx.createRadialGradient(w * 0.62, h * 0.38, 10, w * 0.62, h * 0.38, 130);
        sunGrad.addColorStop(0, look.glow);
        sunGrad.addColorStop(1, 'transparent');
        cgCtx.fillStyle = sunGrad;
        cgCtx.fillRect(0, 0, w, h);

        cgCtx.fillStyle = look.hill;
        cgCtx.beginPath();
        cgCtx.moveTo(0, h);
        cgCtx.lineTo(w * 0.35, h * 0.52);
        cgCtx.lineTo(w * 0.72, h * 0.68);
        cgCtx.lineTo(w, h * 0.48);
        cgCtx.lineTo(w, h);
        cgCtx.fill();
        }
        cgCtx.restore();

        // 3. Divider Line & Handle
        cgCtx.strokeStyle = '#f59e0b';
        cgCtx.lineWidth = 3;
        cgCtx.beginPath();
        cgCtx.moveTo(splitX, 0);
        cgCtx.lineTo(splitX, h);
        cgCtx.stroke();

        cgCtx.fillStyle = '#f59e0b';
        cgCtx.beginPath();
        const handleX = Math.min(w - 16, Math.max(16, splitX));
        cgCtx.arc(handleX, h / 2, 16, 0, Math.PI * 2);
        cgCtx.fill();
        cgCtx.fillStyle = '#000000';
        cgCtx.font = 'bold 11px Inter, sans-serif';
        cgCtx.textAlign = 'center';
        cgCtx.fillText('↔', handleX, h / 2 + 4);

      }

      colorGradeSlider.addEventListener('input', renderColorGradeComparison);
      colorGradeCanvas.style.cursor = 'ew-resize';
      colorGradeCanvas.style.touchAction = 'none';
      let draggingGradeDivider = false;
      function moveGradeDivider(event) {
        const bounds = colorGradeCanvas.getBoundingClientRect();
        const position = (event.clientX - bounds.left) / bounds.width * 100;
        colorGradeSlider.value = String(Math.min(100, Math.max(0, Math.round(position))));
        renderColorGradeComparison();
      }
      colorGradeCanvas.addEventListener('pointerdown', event => {
        draggingGradeDivider = true;
        colorGradeCanvas.setPointerCapture(event.pointerId);
        moveGradeDivider(event);
      });
      colorGradeCanvas.addEventListener('pointermove', event => {
        if (draggingGradeDivider) moveGradeDivider(event);
      });
      colorGradeCanvas.addEventListener('pointerup', () => { draggingGradeDivider = false; });
      colorGradeCanvas.addEventListener('pointercancel', () => { draggingGradeDivider = false; });
      colorGradeCanvas.addEventListener('keydown', event => {
        const current = Number(colorGradeSlider.value);
        let next = current;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 100;
        else return;
        event.preventDefault();
        colorGradeSlider.value = String(Math.min(100, Math.max(0, next)));
        renderColorGradeComparison();
      });
      document.querySelectorAll('.grade-option-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentGradeIndex = Number(btn.getAttribute('data-grade-index'));
          document.getElementById('activeGradeBadge').textContent = gradeOptionLabels[currentGradeIndex];
          document.querySelectorAll('.grade-option-btn').forEach((b) => {
            b.className = 'grade-option-btn px-3 py-2.5 rounded-xl text-xs font-mono font-semibold border border-slate-800 bg-[#121621] text-slate-300 hover:text-white text-left';
          });
          btn.className = 'grade-option-btn px-3 py-2.5 rounded-xl text-xs font-mono font-semibold border border-cyan-500 bg-cyan-500/15 text-cyan-300 text-left';
          renderColorGradeComparison();
        });
      });
      renderColorGradeComparison();

      // --- QUOTE CALCULATOR ---
      let calcCurrency = 'INR';
      let baseRatesInr = {
        youtube: 4500,
        reels: 5500,
        commercial: 7500,
        music: 9000,
        wedding: 12000
      };
      let pricingOptions = { perMinuteInr: 350, motionInr: 2000, colorInr: 1500, soundInr: 1200, rushInr: 2500, usdRate: 82 };
      let servicePricing = {};
      const defaultBillingUnits = { youtube: 'minute', reels: 'video', commercial: 'video', music: 'video', wedding: 'video' };

      function updateQuoteCalculator() {
        const type = document.getElementById('calcProjectType').value;
        const quantity = Number(document.getElementById('calcDurationRange').value);
        const quantitySlider = document.getElementById('calcDurationRange');
        const quantityNumber = document.getElementById('calcQuantityNumber');
        const serviceRate = servicePricing[type] || {};
        const billingUnit = serviceRate.billingUnit === 'video' ? 'video' : 'minute';
        const isPerVideo = billingUnit === 'video';
        quantitySlider.min = isPerVideo ? '1' : '0';
        quantityNumber.min = '1';
        quantityNumber.value = quantity === 0 && !isPerVideo ? '' : String(quantity);
        quantityNumber.setAttribute('aria-label', isPerVideo ? 'Number of videos (1 to 30)' : 'Added minutes (0 to 30)');
        document.getElementById('calcBaseIncludes').textContent = serviceRate.baseIncludes
          ? `${isPerVideo ? 'Each video rate includes' : 'Base project includes'}: ${serviceRate.baseIncludes}`
          : '';
        document.getElementById('calcQuantityLabel').textContent = isPerVideo ? '2. Number of Videos' : '2. Additional Minutes';
        document.getElementById('calcDurationLabel').textContent = isPerVideo
          ? `${quantity} Video${quantity > 1 ? 's' : ''}`
          : quantity === 0 ? 'No added minutes' : `${quantity} Added Minute${quantity > 1 ? 's' : ''}`;
        document.getElementById('calcPricingNote').textContent = isPerVideo
          ? 'The service rate and selected add-ons are charged for each video.'
          : 'The base fee covers the project. Each added minute is charged at the per-minute add-on rate.';

        const motion = document.getElementById('addonMotion').checked;
        const color = document.getElementById('addonColor').checked;
        const sound = document.getElementById('addonSound').checked;
        const rush = document.getElementById('addonRush').checked;

        const rateInr = serviceRate.rateInr ?? baseRatesInr[type];
        const unitMultiplier = isPerVideo ? quantity : 1;
        let totalInr = isPerVideo
          ? rateInr * quantity
          : rateInr + quantity * (serviceRate.extraMinuteRateInr ?? pricingOptions.perMinuteInr);
        const lines = isPerVideo
          ? [`${quantity} video${quantity > 1 ? 's' : ''} × per-video rate`]
          : ['Base fee for the project'];
        if (!isPerVideo && quantity > 0) lines.push(`${quantity} added minute${quantity === 1 ? '' : 's'} × per-minute rate`);

        if (motion) {
          totalInr += (serviceRate.motionInr ?? pricingOptions.motionInr) * unitMultiplier;
          lines.push(isPerVideo ? '+ Motion graphics per video' : '+ After Effects Motion Graphics');
        }
        if (color) {
          totalInr += (serviceRate.colorInr ?? pricingOptions.colorInr) * unitMultiplier;
          lines.push(isPerVideo ? '+ Color grading per video' : '+ DaVinci 10-Bit Color Grading');
        }
        if (sound) {
          totalInr += (serviceRate.soundInr ?? pricingOptions.soundInr) * unitMultiplier;
          lines.push(isPerVideo ? '+ Sound design per video' : '+ Cinema Sound Design & Mastering');
        }
        if (rush) {
          totalInr += (serviceRate.rushInr ?? pricingOptions.rushInr) * unitMultiplier;
          lines.push(isPerVideo ? '+ Rush delivery per video' : '+ 48-Hour Express Rush Delivery');
        }

        const formattedTotal =
          calcCurrency === 'INR'
            ? `₹${totalInr.toLocaleString('en-IN')}`
            : `$${Math.round(totalInr / pricingOptions.usdRate).toLocaleString('en-US')}`;

        document.getElementById('calcTotalDisplay').textContent = formattedTotal;
        document.getElementById('calcBreakdownList').innerHTML = lines
          .map((l) => `<div class="flex items-center gap-2"><span class="text-amber-400">✓</span><span>${l}</span></div>`)
          .join('');
      }

      document.getElementById('calcProjectType').addEventListener('change', () => {
        const serviceRate = servicePricing[document.getElementById('calcProjectType').value];
        const slider = document.getElementById('calcDurationRange');
        const isVideo = serviceRate?.billingUnit === 'video';
        slider.min = isVideo ? '1' : '0';
        slider.value = isVideo ? serviceRate?.defaultQuantity ?? 1 : 0;
        updateQuoteCalculator();
      });

      const quantitySlider = document.getElementById('calcDurationRange');
      const quantityNumber = document.getElementById('calcQuantityNumber');
      quantitySlider.addEventListener('input', updateQuoteCalculator);
      quantityNumber.addEventListener('input', () => {
        const minimum = Number(quantitySlider.min);
        if (quantityNumber.value === '' && minimum === 0) { quantitySlider.value = '0'; updateQuoteCalculator(); return; }
        const value = Math.min(30, Math.max(Math.max(1, minimum), Number(quantityNumber.value) || 1));
        quantitySlider.value = String(value);
        updateQuoteCalculator();
      });
      document.getElementById('calcQuantityPlus').addEventListener('click', () => {
        quantitySlider.value = String(Math.min(30, Number(quantitySlider.value) + 1));
        updateQuoteCalculator();
      });

      ['addonMotion', 'addonColor', 'addonSound', 'addonRush'].forEach((id) => {
        document.getElementById(id).addEventListener('input', updateQuoteCalculator);
        document.getElementById(id).addEventListener('change', updateQuoteCalculator);
      });

      document.getElementById('currencyInrBtn').addEventListener('click', () => {
        calcCurrency = 'INR';
        document.getElementById('currencyInrBtn').className = 'px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold bg-amber-500 text-black';
        document.getElementById('currencyUsdBtn').className = 'px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-400 hover:text-white';
        updateQuoteCalculator();
      });

      document.getElementById('currencyUsdBtn').addEventListener('click', () => {
        calcCurrency = 'USD';
        document.getElementById('currencyUsdBtn').className = 'px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold bg-amber-500 text-black';
        document.getElementById('currencyInrBtn').className = 'px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-slate-400 hover:text-white';
        updateQuoteCalculator();
      });

      document.querySelectorAll('.service-select-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-service-preset');
          document.getElementById('calcProjectType').value = preset;
          document.getElementById('calcProjectType').dispatchEvent(new Event('change', { bubbles: true }));
          document.getElementById('calculator').scrollIntoView({ behavior: 'smooth' });
        });
      });

      document.getElementById('applyQuoteToContactBtn').addEventListener('click', () => {
        const estimate = document.getElementById('calcTotalDisplay').textContent;
        const typeSelect = document.getElementById('calcProjectType');
        const selectedText = typeSelect.options[typeSelect.selectedIndex].text;
        document.getElementById('clientBudget').value = estimate;
        document.getElementById('clientMessage').value = `Hi Rana, I used your quote calculator for "${selectedText}" (Estimated: ${estimate}). Let's discuss this project.`;
        document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
        showToast('Quote attached to Contact Form below!');
      });

      updateQuoteCalculator();

      // --- COPY EMAIL & CONTACT FORM SUBMISSION ---
      document.getElementById('copyEmailBtn').addEventListener('click', () => {
        const email = document.getElementById('ranaEmailText').textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(email).catch(() => {});
        } else {
          const ta = document.createElement('textarea');
          ta.value = email;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast(`Copied ${email} to clipboard!`);
      });

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character]);
      }

      document.getElementById('contactForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const banner = document.getElementById('contactSuccessBanner');
        const form = e.currentTarget;
        const submitButton = form.querySelector('button[type="submit"]');
        const payload = {
          name: document.getElementById('clientName').value.trim(),
          email: document.getElementById('clientEmail').value.trim(),
          project: document.getElementById('clientProjectType').value,
          budget: document.getElementById('clientBudget').value.trim(),
          reference: document.getElementById('clientDriveLink').value.trim(),
          message: document.getElementById('clientMessage').value.trim(),
          website: document.getElementById('website').value
        };
        submitButton.disabled = true;
        banner.classList.add('hidden');
        banner.classList.remove('text-rose-300');
        try {
          const response = await fetch('/api/public/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Could not save your inquiry. Please try again.');
          banner.textContent = 'Thanks — your brief is saved in Rana’s private inbox. He can review it and reply to your email.';
          banner.classList.remove('hidden');
          form.reset();
          showToast('Your project inquiry was saved.');
        } catch (error) {
          banner.textContent = error.message;
          banner.classList.remove('hidden');
          banner.classList.add('text-rose-300');
        } finally {
          submitButton.disabled = false;
        }
      });

      // Load the content managed in the password-protected admin panel.
      fetch('/api/public/content')
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Content unavailable')))
        .then((content) => {
          const colorPreview = content.colorPreview || {};
          gradeImages.before = loadGradeImage(colorPreview.beforeImage);
          gradeOptionLabels = Array.from({ length: 4 }, (_, index) => colorPreview.gradeOptions?.[index]?.label || `Graded Image ${index + 1}`);
          gradeImages.graded = Array.from({ length: 4 }, (_, index) => loadGradeImage(colorPreview.gradeOptions?.[index]?.imageUrl));
          document.querySelectorAll('.grade-option-btn').forEach((button, index) => { button.textContent = gradeOptionLabels[index]; });
          document.getElementById('activeGradeBadge').textContent = gradeOptionLabels[currentGradeIndex];
          const previewText = { colorPreviewEyebrow: colorPreview.eyebrow, colorPreviewTitle: colorPreview.title, colorPreviewDescription: colorPreview.description };
          Object.entries(previewText).forEach(([key, value]) => { const element = document.querySelector(`[data-content="${key}"]`); if (element && typeof value === 'string') element.textContent = value; });
          if (colorPreview.beforeLabel) document.getElementById('gradeBeforeLabel').textContent = colorPreview.beforeLabel;
          if (colorPreview.afterLabel) document.getElementById('gradeAfterLabel').textContent = colorPreview.afterLabel;
          const nodeTree = document.getElementById('gradeNodeTree');
          const nodeTreeText = typeof colorPreview.nodeTree === 'string' ? colorPreview.nodeTree.trim() : '';
          nodeTree.textContent = nodeTreeText;
          nodeTree.title = nodeTreeText;
          nodeTree.classList.toggle('hidden', !nodeTreeText);
          if (Number.isFinite(Number(colorPreview.split))) { colorGradeSlider.value = String(Math.min(100, Math.max(0, Number(colorPreview.split)))); }
          renderColorGradeComparison();
          document.querySelectorAll('[data-content]').forEach((element) => {
            const value = content[element.dataset.content];
            if (typeof value !== 'string') return;
            if (element.classList.contains('brand-wordmark') && value === 'RM-Edits') return;
            element.textContent = value;
          });
          if (Array.isArray(content.services)) {
            content.services.forEach((service, index) => {
              const title = document.querySelector(`[data-service-title="${index}"]`);
              const description = document.querySelector(`[data-service-description="${index}"]`);
              const button = document.querySelector(`[data-service-button="${index}"]`);
              if (title) title.textContent = service.title;
              if (description) description.textContent = service.description;
              if (button) button.textContent = service.buttonLabel;
            });
          }
          document.title = `${content.brandName} | ${content.role}`;
          document.getElementById('copyrightYear').textContent = new Date().getFullYear();
          const emailCard = document.getElementById('directEmailCard');
          if (content.email) emailCard.classList.remove('hidden');
          const calculatorControls = document.getElementById('quoteCalculatorControls');
          const calculatorNotice = document.getElementById('quoteCalculatorNotice');
          if (content.pricingEnabled) {
            calculatorControls.classList.remove('hidden');
            calculatorNotice.classList.add('hidden');
          }
          if (content.pricing) {
            baseRatesInr = content.pricing.baseRatesInr || baseRatesInr;
            pricingOptions = { ...pricingOptions, ...content.pricing };
            servicePricing = Object.fromEntries(Object.entries(baseRatesInr).map(([key, legacyRateInr]) => {
              const configured = content.pricing.serviceRates?.[key] || {};
              const billingUnit = configured.billingUnit === 'minute' || configured.billingUnit === 'video'
                ? configured.billingUnit
                : defaultBillingUnits[key] || 'minute';
              const legacyRate = billingUnit === 'video'
                ? configured.rateInr ?? configured.fixedRateInr ?? legacyRateInr
                : configured.extraMinuteRateInr !== undefined
                  ? configured.rateInr ?? configured.baseFeeInr ?? configured.fixedRateInr ?? legacyRateInr
                  : configured.baseFeeInr ?? configured.fixedRateInr ?? legacyRateInr;
              const serviceRate = {
                billingUnit,
                rateInr: legacyRate,
                extraMinuteRateInr: configured.extraMinuteRateInr ?? (billingUnit === 'minute' ? configured.rateInr ?? content.pricing.perMinuteInr ?? pricingOptions.perMinuteInr : undefined),
                defaultQuantity: billingUnit === 'video' ? configured.defaultVideos ?? configured.defaultQuantity ?? 1 : 0,
                motionInr: configured.motionInr ?? content.pricing.motionInr ?? pricingOptions.motionInr,
                colorInr: configured.colorInr ?? content.pricing.colorInr ?? pricingOptions.colorInr,
                soundInr: configured.soundInr ?? content.pricing.soundInr ?? pricingOptions.soundInr,
                rushInr: configured.rushInr ?? content.pricing.rushInr ?? pricingOptions.rushInr,
                baseIncludes: configured.baseIncludes || ''
              };
              const label = configured.label || content.pricing.typeLabels?.[key];
              if (typeof label === 'string' && label.trim()) {
                serviceRate.label = label;
                const option = document.querySelector(`#calcProjectType option[value="${key}"]`);
                if (option) option.textContent = label;
              }
              return [key, serviceRate];
            }));
            const selectedService = servicePricing[document.getElementById('calcProjectType').value];
            const slider = document.getElementById('calcDurationRange');
            const selectedIsVideo = selectedService?.billingUnit === 'video';
            slider.min = selectedIsVideo ? '1' : '0';
            slider.value = selectedIsVideo ? selectedService?.defaultQuantity ?? 1 : 0;
            updateQuoteCalculator();
          }
          if (Array.isArray(content.projects)) {
            portfolioProjects = content.projects;
            renderPortfolio();
          }
          const showreelVideo = document.getElementById('showreelVideo');
          const showreelPath = typeof content.showreelVideo === 'string' && (/^\/media\/showreel\.(?:mp4|webm)$/.test(content.showreelVideo) || /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(content.showreelVideo)) ? content.showreelVideo : '';
          const thumbnailPath = typeof content.showreelThumbnail === 'string' && (/^\/media\/showreel-thumbnail\.(?:jpg|png|webp)$/.test(content.showreelThumbnail) || /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(content.showreelThumbnail)) ? content.showreelThumbnail : '';
          const youtubeId = getYouTubeVideoId(content.showreelYoutubeUrl || '');
          const youtubeFrame = document.getElementById('showreelYoutube');
          const youtubeLaunch = document.getElementById('showreelYoutubeLaunch');
          const youtubePoster = document.getElementById('showreelYoutubePoster');
          const showreelCanvas = document.getElementById('showreelCanvas');
          const reelHud = document.getElementById('reelHud');
          const reelControls = document.getElementById('reelControls');
          if (youtubeId) {
            showreelVideo.pause();
            showreelVideo.classList.add('hidden');
            showreelCanvas.classList.add('hidden');
            reelHud.classList.add('hidden');
            reelControls.classList.add('hidden');
            youtubeFrame.removeAttribute('src');
            youtubeFrame.classList.add('hidden');
            youtubePoster.src = thumbnailPath || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
            youtubeLaunch.classList.remove('hidden');
            youtubeLaunch.onclick = () => {
              youtubeFrame.src = `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&controls=0&rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`;
              youtubeFrame.classList.remove('hidden');
              youtubeLaunch.classList.add('hidden');
            };
            document.getElementById('reelSceneBadge').textContent = 'YOUTUBE SHOWREEL';
            document.querySelector('.monitor-file-label')?.replaceChildren(document.createTextNode('RM-EDITS • SHOWREEL'));
          } else if (showreelPath) {
            youtubeLaunch.classList.add('hidden');
            youtubeFrame.removeAttribute('src');
            youtubeFrame.classList.add('hidden');
            if (thumbnailPath) showreelVideo.poster = thumbnailPath;
            else showreelVideo.removeAttribute('poster');
            showreelVideo.src = showreelPath;
            showreelVideo.classList.remove('hidden');
            showreelCanvas.classList.add('hidden');
            reelHud.classList.add('hidden');
            reelControls.classList.add('hidden');
            document.getElementById('reelSceneBadge').textContent = 'SHOWREEL';
            document.querySelector('.monitor-file-label')?.replaceChildren(document.createTextNode('RM-EDITS • SHOWREEL'));
          } else {
            youtubeLaunch.classList.add('hidden');
            youtubeFrame.removeAttribute('src');
            youtubeFrame.classList.add('hidden');
            showreelVideo.pause();
            showreelVideo.removeAttribute('src');
            showreelVideo.load();
            showreelVideo.classList.add('hidden');
            showreelCanvas.classList.remove('hidden');
            reelHud.classList.remove('hidden');
            reelControls.classList.remove('hidden');
          }
        })
        .catch(() => {});

      function getYouTubeVideoId(rawUrl) {
        try {
          const url = new URL(rawUrl);
          if (url.protocol !== 'https:') return '';
          let id = '';
          if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) id = url.pathname.split('/').filter(Boolean)[0] || '';
          else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] || '';
          return /^[\w-]{11}$/.test(id) ? id : '';
        } catch { return ''; }
      }

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
