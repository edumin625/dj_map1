/**
 * 부산 편의점 인터랙티브 지도 웹 애플리케이션
 */

document.addEventListener('DOMContentLoaded', () => {
  // 상태 관리 객체
  const state = {
    allStores: [],
    filteredStores: [],
    selectedGu: '',
    selectedDong: '',
    selectedBrands: new Set(['ALL']),
    searchKeyword: '',
    currentLocationMarker: null,
    storeMarkersMap: new Map(), // id -> marker
    isMobile: window.innerWidth < 1024
  };

  // 브랜드 색상 및 설정
  const BRAND_CONFIG = {
    'CU': { color: '#6b21a8', bg: '#f3e8ff', badgeClass: 'badge-cu' },
    'GS25': { color: '#0284c7', bg: '#e0f2fe', badgeClass: 'badge-gs25' },
    '세븐일레븐': { color: '#15803d', bg: '#dcfce7', badgeClass: 'badge-7eleven' },
    '이마트24': { color: '#d97706', bg: '#fef3c7', badgeClass: 'badge-emart24' },
    '기타': { color: '#475569', bg: '#f1f5f9', badgeClass: 'badge-other' }
  };

  // DOM 요소 캐싱
  const guSelect = document.getElementById('guSelect');
  const dongSelect = document.getElementById('dongSelect');
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const resetFilterBtn = document.getElementById('resetFilterBtn');
  const brandChips = document.querySelectorAll('.brand-chip');
  const resultsCountEl = document.getElementById('resultsCount');
  const storesListEl = document.getElementById('storesList');
  const emptyStateEl = document.getElementById('emptyState');
  const sidebar = document.getElementById('sidebar');
  const bottomSheetHandle = document.getElementById('bottomSheetHandle');
  const bottomSheetBackdrop = document.getElementById('bottomSheetBackdrop');
  const mobileSearchTrigger = document.getElementById('mobileSearchTrigger');
  const mobileGpsBtn = document.getElementById('mobileGpsBtn');
  const gpsBtn = document.getElementById('gpsBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const fitBoundsBtn = document.getElementById('fitBoundsBtn');
  const tileBtns = document.querySelectorAll('.tile-btn');

  // ================= 1. Leaflet 지도 초기화 =================
  // 부산 중심 좌표 (35.179554, 129.075641)
  const map = L.map('map', {
    center: [35.179554, 129.075641],
    zoom: 12,
    zoomControl: false // 커스텀 버튼 사용
  });

  // 완전 무료 오픈소스 타일 레이어 (API Key 불필요)
  const tileLayers = {
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    })
  };

  tileLayers.osm.addTo(map);
  let currentTileKey = 'osm';

  // 마커 클러스터 그룹
  const markersCluster = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 50,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let size = count < 50 ? 36 : count < 200 ? 44 : 52;
      return L.divIcon({
        html: `<div class="cluster-custom" style="width:${size}px; height:${size}px;">${count}</div>`,
        className: 'custom-cluster-icon',
        iconSize: L.point(size, size)
      });
    }
  });

  map.addLayer(markersCluster);

  // 커스텀 SVG 마커 핀 생성
  function createCustomPin(brand) {
    const config = BRAND_CONFIG[brand] || BRAND_CONFIG['기타'];
    const color = config.color;

    const svgIcon = `
      <svg class="custom-pin" viewBox="0 0 32 38" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.16344 0 0 7.16344 0 16C0 26.5 16 38 16 38C16 38 32 26.5 32 16C32 7.16344 24.8366 0 16 0Z" fill="${color}"/>
        <circle cx="16" cy="15" r="7.5" fill="#FFFFFF"/>
        <text x="16" y="18.5" font-size="8" font-weight="bold" fill="${color}" text-anchor="middle" font-family="sans-serif">
          ${brand === '세븐일레븐' ? '7' : brand === '이마트24' ? '24' : brand === '기타' ? '편' : brand.slice(0, 2)}
        </text>
      </svg>
    `;

    return L.divIcon({
      html: svgIcon,
      className: 'store-div-icon',
      iconSize: [32, 38],
      iconAnchor: [16, 38],
      popupAnchor: [0, -34]
    });
  }

  // 팝업 HTML 생성
  function createPopupContent(store) {
    const brand = store.brand;
    const config = BRAND_CONFIG[brand] || BRAND_CONFIG['기타'];
    const branchText = store.branch ? ` <span style="color:#64748b; font-size:0.9rem;">${escapeHtml(store.branch)}</span>` : '';
    
    // 길찾기 URL 생성
    const kakaoMapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(store.name)},${store.lat},${store.lng}`;
    const naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(store.road || store.name)}`;

    return `
      <div class="popup-card">
        <div class="popup-header">
          <span class="store-badge ${config.badgeClass}">${brand}</span>
          <span class="popup-title">${escapeHtml(store.name)}${branchText}</span>
        </div>
        <div class="popup-addr">
          <p><strong>도로명:</strong> ${escapeHtml(store.road || '-')}</p>
          <p style="margin-top:2px;"><strong>지번:</strong> ${escapeHtml(store.jibun || '-')}</p>
        </div>
        <div class="popup-buttons">
          <a href="${kakaoMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-kakao">카카오 길찾기</a>
          <a href="${naverMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-naver">네이버 지도</a>
        </div>
      </div>
    `;
  }

  // ================= 2. 데이터 로드 및 초기 세팅 =================
  async function loadData() {
    try {
      if (window.STORE_DATA && Array.isArray(window.STORE_DATA)) {
        state.allStores = window.STORE_DATA;
      } else {
        const response = await fetch('data/stores.json');
        state.allStores = await response.json();
      }

      initGuAndDongOptions();
      applyFilters();
    } catch (err) {
      console.error('데이터 로드 실패:', err);
      alert('편의점 데이터를 불러오는데 실패했습니다.');
    }
  }

  // 구·군 및 행정동 옵션 생성
  function initGuAndDongOptions() {
    const guSet = new Set();
    state.allStores.forEach(s => {
      if (s.gu) guSet.add(s.gu);
    });

    const sortedGus = Array.from(guSet).sort((a, b) => a.localeCompare(b, 'ko'));
    guSelect.innerHTML = '<option value="">부산시 전체 (구·군)</option>';
    sortedGus.forEach(gu => {
      const opt = document.createElement('option');
      opt.value = gu;
      opt.textContent = gu;
      guSelect.appendChild(opt);
    });

    updateDongOptions();
  }

  function updateDongOptions() {
    dongSelect.innerHTML = '<option value="">행정동 전체</option>';
    if (!state.selectedGu) {
      dongSelect.disabled = true;
      return;
    }

    dongSelect.disabled = false;
    const dongSet = new Set();
    state.allStores.forEach(s => {
      if (s.gu === state.selectedGu && s.dong) {
        dongSet.add(s.dong);
      }
    });

    const sortedDongs = Array.from(dongSet).sort((a, b) => a.localeCompare(b, 'ko'));
    sortedDongs.forEach(dong => {
      const opt = document.createElement('option');
      opt.value = dong;
      opt.textContent = dong;
      dongSelect.appendChild(opt);
    });
  }

  // ================= 3. 필터링 로직 =================
  function applyFilters() {
    const query = state.searchKeyword.trim().toLowerCase();

    state.filteredStores = state.allStores.filter(store => {
      // 1. 구 필터
      if (state.selectedGu && store.gu !== state.selectedGu) return false;

      // 2. 동 필터
      if (state.selectedDong && store.dong !== state.selectedDong) return false;

      // 3. 브랜드 필터
      if (!state.selectedBrands.has('ALL') && !state.selectedBrands.has(store.brand)) {
        return false;
      }

      // 4. 검색어 필터
      if (query) {
        const targetText = `${store.name} ${store.branch} ${store.road} ${store.jibun}`.toLowerCase();
        if (!targetText.includes(query)) return false;
      }

      return true;
    });

    // 지도 마커 업데이트
    updateMapMarkers();

    // 결과 리스트 DOM 업데이트
    renderStoresList();

    // 통계 개수 업데이트
    resultsCountEl.textContent = state.filteredStores.length.toLocaleString();
    const previewCountEl = document.getElementById('mobilePreviewCount');
    if (previewCountEl) previewCountEl.textContent = state.filteredStores.length.toLocaleString();
  }

  // 지도 마커 및 클러스터 갱신
  function updateMapMarkers() {
    markersCluster.clearLayers();
    state.storeMarkersMap.clear();

    const markersToAdd = [];
    const bounds = L.latLngBounds();

    state.filteredStores.forEach(store => {
      const lat = store.lat;
      const lng = store.lng;
      const latLng = [lat, lng];

      bounds.extend(latLng);

      const marker = L.marker(latLng, {
        icon: createCustomPin(store.brand)
      });

      marker.bindPopup(createPopupContent(store));
      markersToAdd.push(marker);
      state.storeMarkersMap.set(store.id, marker);
    });

    markersCluster.addLayers(markersToAdd);

    // 필터 조건이 적용된 경우 해당 범위로 줌 이동
    if (state.filteredStores.length > 0 && (state.selectedGu || state.searchKeyword)) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }

  // 리스트 렌더링 (최대 100건 우선 렌더링으로 부드러운 성능 보장)
  function renderStoresList() {
    storesListEl.innerHTML = '';

    if (state.filteredStores.length === 0) {
      emptyStateEl.style.display = 'flex';
      return;
    }

    emptyStateEl.style.display = 'none';

    // 가상화/청크 렌더링: 처음 80개만 우선 렌더링하고 스크롤 시 추가
    const displayChunk = state.filteredStores.slice(0, 80);
    displayChunk.forEach(store => {
      const card = createStoreCard(store);
      storesListEl.appendChild(card);
    });

    if (state.filteredStores.length > 80) {
      const moreInfo = document.createElement('div');
      moreInfo.style.textAlign = 'center';
      moreInfo.style.padding = '0.5rem';
      moreInfo.style.fontSize = '0.75rem';
      moreInfo.style.color = '#94a3b8';
      moreInfo.textContent = `외 ${state.filteredStores.length - 80}개 매장이 더 있습니다. 지도를 확대하거나 상세 검색을 이용해보세요.`;
      storesListEl.appendChild(moreInfo);
    }
  }

  function createStoreCard(store) {
    const card = document.createElement('div');
    card.className = 'store-card';
    card.dataset.id = store.id;

    const brand = store.brand;
    const config = BRAND_CONFIG[brand] || BRAND_CONFIG['기타'];
    const branchText = store.branch ? `<span class="store-branch">${escapeHtml(store.branch)}</span>` : '';

    const kakaoMapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(store.name)},${store.lat},${store.lng}`;

    card.innerHTML = `
      <div class="store-card-header">
        <span class="store-badge ${config.badgeClass}">${brand}</span>
        <span class="store-name">${escapeHtml(store.name)}</span>
        ${branchText}
      </div>
      <div class="store-address">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        <span>${escapeHtml(store.road || store.jibun || '')}</span>
      </div>
      <div class="store-card-footer">
        <span>${escapeHtml(store.gu)} ${escapeHtml(store.dong)}</span>
        <div class="nav-links-wrap">
          <a href="${kakaoMapUrl}" target="_blank" rel="noopener noreferrer" class="nav-link-btn" onclick="event.stopPropagation();">
            길찾기 &rarr;
          </a>
        </div>
      </div>
    `;

    // 카드 클릭 시 해당 매장으로 이동 및 팝업 열기
    card.addEventListener('click', () => {
      // 선택 하이라이트
      document.querySelectorAll('.store-card.selected').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');

      focusStore(store);

      // 모바일인 경우 바텀 시트 살짝 접기
      if (window.innerWidth < 1024) {
        sidebar.classList.remove('expanded');
        bottomSheetBackdrop.classList.remove('active');
      }
    });

    return card;
  }

  // 매장 좌표로 포커스
  function focusStore(store) {
    map.flyTo([store.lat, store.lng], 17, {
      animate: true,
      duration: 0.8
    });

    const marker = state.storeMarkersMap.get(store.id);
    if (marker) {
      // 클러스터 안에 있어도 마커를 꺼내서 팝업 표시
      markersCluster.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    }
  }

  // ================= 4. 이벤트 리스너 등록 =================

  // 구 선택 변경
  guSelect.addEventListener('change', (e) => {
    state.selectedGu = e.target.value;
    state.selectedDong = '';
    updateDongOptions();
    applyFilters();
  });

  // 동 선택 변경
  dongSelect.addEventListener('change', (e) => {
    state.selectedDong = e.target.value;
    applyFilters();
  });

  // 브랜드 칩 클릭
  brandChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const brand = chip.dataset.brand;

      if (brand === 'ALL') {
        state.selectedBrands.clear();
        state.selectedBrands.add('ALL');
        brandChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      } else {
        // ALL 해제
        const allChip = document.querySelector('.brand-chip[data-brand="ALL"]');
        if (state.selectedBrands.has('ALL')) {
          state.selectedBrands.delete('ALL');
          allChip.classList.remove('active');
        }

        if (state.selectedBrands.has(brand)) {
          state.selectedBrands.delete(brand);
          chip.classList.remove('active');
        } else {
          state.selectedBrands.add(brand);
          chip.classList.add('active');
        }

        // 아무것도 선택되지 않았으면 다시 ALL 활성화
        if (state.selectedBrands.size === 0) {
          state.selectedBrands.add('ALL');
          allChip.classList.add('active');
        }
      }

      applyFilters();
    });
  });

  // 검색어 입력 (디바운스 250ms)
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    searchClearBtn.style.display = val ? 'block' : 'none';

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.searchKeyword = val;
      applyFilters();
    }, 250);
  });

  // 검색어 지우기 버튼
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    state.searchKeyword = '';
    applyFilters();
    searchInput.focus();
  });

  // 필터 초기화
  resetFilterBtn.addEventListener('click', () => {
    state.selectedGu = '';
    state.selectedDong = '';
    state.searchKeyword = '';
    state.selectedBrands.clear();
    state.selectedBrands.add('ALL');

    guSelect.value = '';
    dongSelect.innerHTML = '<option value="">행정동 전체</option>';
    dongSelect.disabled = true;
    searchInput.value = '';
    searchClearBtn.style.display = 'none';

    brandChips.forEach(c => {
      if (c.dataset.brand === 'ALL') c.classList.add('active');
      else c.classList.remove('active');
    });

    applyFilters();
    map.setView([35.179554, 129.075641], 12);
  });

  // 타일맵 전환 (CartoDB vs OSM)
  tileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.tile;
      if (type === currentTileKey) return;

      map.removeLayer(tileLayers[currentTileKey]);
      tileLayers[type].addTo(map);
      currentTileKey = type;

      tileBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 줌 컨트롤 버튼
  zoomInBtn.addEventListener('click', () => map.zoomIn());
  zoomOutBtn.addEventListener('click', () => map.zoomOut());
  fitBoundsBtn.addEventListener('click', () => {
    map.setView([35.179554, 129.075641], 12);
  });

  // 현위치(GPS) 찾기
  function handleLocationClick() {
    if (!navigator.geolocation) {
      alert('이 브라우저는 위치 정보(GPS)를 지원하지 않습니다.');
      return;
    }

    const btn = gpsBtn;
    btn.classList.add('active');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove('active');
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (state.currentLocationMarker) {
          map.removeLayer(state.currentLocationMarker);
        }

        // 현재 위치 펄스 마커 추가
        const locIcon = L.divIcon({
          html: '<div style="width:18px; height:18px; background:#2563eb; border:3px solid #ffffff; border-radius:50%; box-shadow:0 0 12px rgba(37,99,235,0.8);"></div>',
          className: 'current-loc-icon',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        state.currentLocationMarker = L.marker([lat, lng], { icon: locIcon }).addTo(map);
        state.currentLocationMarker.bindPopup('<strong>내 위치</strong>').openPopup();

        map.flyTo([lat, lng], 15);
      },
      (err) => {
        btn.classList.remove('active');
        console.warn('위치 확인 실패:', err.message);
        alert('현재 위치 정보를 가져올 수 없습니다. 브라우저 위치 권한을 확인해주세요.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  gpsBtn.addEventListener('click', handleLocationClick);
  mobileGpsBtn.addEventListener('click', handleLocationClick);

  // 모바일 상단 바 클릭 시 바텀시트 펼치기
  mobileSearchTrigger.addEventListener('click', () => {
    sidebar.classList.add('expanded');
    bottomSheetBackdrop.classList.add('active');
    searchInput.focus();
  });

  // 모바일 바텀시트 핸들 클릭 토글
  bottomSheetHandle.addEventListener('click', () => {
    sidebar.classList.toggle('expanded');
    bottomSheetBackdrop.classList.toggle('active');
  });

  bottomSheetBackdrop.addEventListener('click', () => {
    sidebar.classList.remove('expanded');
    bottomSheetBackdrop.classList.remove('active');
  });

  // 유틸리티: HTML 이스케이프
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 앱 구동 시작
  loadData();
});
