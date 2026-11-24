
/* =========================================
   BECOLOG — SCRIPT PRINCIPAL
   Firebase Authentication + Firestore
   Acessibilidade
   Entregas em tempo real
   Identificação do entregador
   Acompanhamento com mini mapa (Leaflet)
   Histórico
   Chat
========================================= */

// =====================================
// VARIÁVEIS GLOBAIS
// =====================================

let currentRole = 'vendor';
let registerRole = 'vendor';

let currentUser = null;
let currentUserData = null;

let unsubscribeDeliveries = [];
let historyUnsubscribe = null;
let chatUnsubscribe = null;

let currentChatDeliveryId = null;
let currentChatDelivery = null;
let chatReturnView = null;

let chatSending = false;
let deliveryActionPending = false;

let entregasEmpresaAtuais = [];
let entregaAcompanhamentoId = null;

const miniMapsInstances = new Map();
const geocodeCache = new Map();

let authStateInitialized = false;
let trackingRenderToken = 0;

// =====================================
// UTILITÁRIOS
// =====================================

function elemento(id) {
    return document.getElementById(id);
}

function usuarioAutenticado() {
    return Boolean(
        currentUser &&
        auth.currentUser &&
        currentUser.uid === auth.currentUser.uid
    );
}

function anunciarLeitorTela(mensagem) {
    const announcer = elemento('sr-announcer');
    if (!announcer) return;

    announcer.textContent = '';

    setTimeout(() => {
        announcer.textContent = mensagem;
    }, 50);
}

function exibirFeedback(containerId, mensagem, tipo = 'error') {
    const el = elemento(containerId);
    if (!el) return;

    el.textContent = mensagem;
    el.className = `feedback-banner ${tipo}`;
    el.hidden = false;

    anunciarLeitorTela(mensagem);
}

function limparFeedback(containerId) {
    const el = elemento(containerId);
    if (!el) return;

    el.textContent = '';
    el.hidden = true;
}

function marcarCampoInvalido(campoId, invalido) {
    const campo = elemento(campoId);
    if (!campo) return;

    if (invalido) {
        campo.setAttribute('aria-invalid', 'true');
    } else {
        campo.removeAttribute('aria-invalid');
    }
}

function limparErrosCampos(ids) {
    ids.forEach(id => marcarCampoInvalido(id, false));
}

function escaparHTML(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caractere]);
}

function obterData(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') {
        return 'Data não disponível';
    }

    return timestamp.toDate().toLocaleString('pt-BR');
}

function obterMilissegundos(timestamp) {
    return timestamp?.toMillis?.() || 0;
}

function normalizarStatus(status) {
    return String(status || '')
        .trim()
        .toLowerCase()
        .replaceAll(' ', '_');
}

function formatarStatus(status) {
    const estados = {
        pendente: 'Aguardando entregador',
        aceita: 'Aceita',
        em_andamento: 'Em trânsito',
        em_transito: 'Em trânsito',
        coletado: 'Coletada',
        concluida: 'Concluída',
        cancelada: 'Cancelada'
    };

    return estados[normalizarStatus(status)] || status || 'Indefinido';
}

function nomeUsuario() {
    return currentUserData?.name ||
        currentUserData?.nome ||
        currentUser?.displayName ||
        currentUser?.email ||
        'Usuário';
}

function telefoneUsuario() {
    return currentUserData?.telefone ||
        currentUserData?.phone ||
        currentUserData?.celular ||
        '';
}

function pararListener(listener) {
    if (typeof listener === 'function') {
        listener();
    }
}

function isEntregaEmAndamento(status) {
    const st = normalizarStatus(status);
    return st !== 'concluida' && st !== 'cancelada';
}

// =====================================
// SELEÇÃO DE PERFIL
// =====================================

function selectRole(role) {
    if (!['vendor', 'driver'].includes(role)) return;

    currentRole = role;

    const vendor = elemento('btn-vendor');
    const driver = elemento('btn-driver');

    if (vendor) {
        vendor.classList.toggle('active-role', role === 'vendor');
        vendor.setAttribute('aria-pressed', String(role === 'vendor'));
    }

    if (driver) {
        driver.classList.toggle('active-role', role === 'driver');
        driver.setAttribute('aria-pressed', String(role === 'driver'));
    }

    anunciarLeitorTela(
        role === 'vendor'
            ? 'Perfil selecionado: Empresa.'
            : 'Perfil selecionado: Entregador.'
    );
}

function selectRegisterRole(role) {
    if (!['vendor', 'driver'].includes(role)) return;

    registerRole = role;

    const vendor = elemento('register-vendor');
    const driver = elemento('register-driver');

    if (!vendor || !driver) return;

    vendor.classList.toggle('active-role', role === 'vendor');
    driver.classList.toggle('active-role', role === 'driver');

    vendor.setAttribute('aria-pressed', String(role === 'vendor'));
    driver.setAttribute('aria-pressed', String(role === 'driver'));

    anunciarLeitorTela(
        role === 'vendor'
            ? 'Perfil de cadastro selecionado: Empresa.'
            : 'Perfil de cadastro selecionado: Entregador.'
    );
}

// =====================================
// LOGIN
// =====================================

async function doLogin() {
    limparFeedback('auth-feedback');

    limparErrosCampos([
        'login-email',
        'login-password'
    ]);

    const email = elemento('login-email')?.value.trim() || '';
    const password = elemento('login-password')?.value || '';

    if (!email) {
        marcarCampoInvalido('login-email', true);
        exibirFeedback('auth-feedback', 'Informe seu endereço de e-mail.');
        elemento('login-email')?.focus();
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        marcarCampoInvalido('login-email', true);
        exibirFeedback('auth-feedback', 'Informe um endereço de e-mail válido.');
        elemento('login-email')?.focus();
        return;
    }

    if (!password) {
        marcarCampoInvalido('login-password', true);
        exibirFeedback('auth-feedback', 'Informe sua senha.');
        elemento('login-password')?.focus();
        return;
    }

    try {
        const result = await auth.signInWithEmailAndPassword(email, password);

        currentUser = result.user;

        const userDoc = await db.collection('users')
            .doc(currentUser.uid)
            .get();

        if (!userDoc.exists) {
            throw new Error('Perfil do usuário não encontrado no banco de dados.');
        }

        const userData = userDoc.data();

        if (!['vendor', 'driver'].includes(userData.role)) {
            throw new Error('Perfil cadastrado inválido.');
        }

        if (userData.role !== currentRole) {
            const profile = userData.role === 'vendor'
                ? 'Empresa'
                : 'Entregador';

            await auth.signOut();

            currentUser = null;
            currentUserData = null;

            throw new Error(
                `Esta conta pertence ao perfil ${profile}. Selecione o perfil correto.`
            );
        }

        currentUserData = userData;

        abrirAplicacao(userData);

    } catch (error) {
        console.error('Erro no login:', error);

        if (auth.currentUser) {
            await auth.signOut().catch(console.error);
        }

        currentUser = null;
        currentUserData = null;

        const mensagens = {
            'auth/invalid-credential': 'E-mail ou senha incorretos.',
            'auth/user-not-found': 'Nenhuma conta encontrada com este e-mail.',
            'auth/wrong-password': 'Senha incorreta.',
            'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
            'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.'
        };

        exibirFeedback(
            'auth-feedback',
            mensagens[error.code] || error.message || 'Não foi possível entrar.',
            'error'
        );
    }
}

// =====================================
// ABRIR APLICAÇÃO
// =====================================

function abrirAplicacao(userData) {
    if (!usuarioAutenticado()) return;

    currentRole = userData.role;
    currentUserData = userData;

    limparFeedback('auth-feedback');
    limparFeedback('app-feedback');

    const login = elemento('view-login');
    const app = elemento('view-app');
    const navList = elemento('nav-list');

    if (login) login.hidden = true;
    if (app) app.hidden = false;

    if (!navList) return;

    const title = elemento('header-title');
    const subtitle = elemento('header-subtitle');
    const userName = elemento('user-name');

    if (userName) {
        userName.hidden = false;
        userName.textContent = nomeUsuario();
    }

    chatReturnView = null;

    if (currentRole === 'vendor') {
        if (title) title.textContent = 'Painel da Empresa';

        if (subtitle) {
            subtitle.textContent = 'Gerencie e acompanhe seus pedidos.';
        }

        navList.innerHTML = `
            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-vendor-dash"
                    onclick="navigateApp('sub-vendor-dash')">
                    Dashboard
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-vendor-new"
                    onclick="navigateApp('sub-vendor-new')">
                    Nova Solicitação
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-vendor-track"
                    onclick="navigateApp('sub-vendor-track')">
                    Acompanhamento
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-chat-list"
                    onclick="abrirListaConversas()">
                    Conversas
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-history"
                    onclick="navigateApp('sub-history')">
                    Histórico
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    onclick="logout()">
                    Sair
                </button>
            </li>
        `;

        navigateApp('sub-vendor-dash');

    } else {
        if (title) title.textContent = 'Entregas Disponíveis';

        if (subtitle) {
            subtitle.textContent = 'Acompanhe suas solicitações.';
        }

        navList.innerHTML = `
            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-driver-dash"
                    onclick="navigateApp('sub-driver-dash')">
                    Minhas Entregas
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-chat-list"
                    onclick="abrirListaConversas()">
                    Conversas
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    data-target="sub-history"
                    onclick="navigateApp('sub-history')">
                    Histórico
                </button>
            </li>

            <li>
                <button type="button" class="nav-btn"
                    onclick="logout()">
                    Sair
                </button>
            </li>
        `;

        navigateApp('sub-driver-dash');
    }

    observarEntregas();
    observarHistorico();

    elemento('main-content')?.focus();
}

// =====================================
// RESTAURAR SESSÃO FIREBASE
// =====================================

function iniciarAutenticacao() {
    if (authStateInitialized) return;
    authStateInitialized = true;

    auth.onAuthStateChanged(async user => {
        if (!user) {
            currentUser = null;
            currentUserData = null;

            const app = elemento('view-app');
            const login = elemento('view-login');

            if (app) app.hidden = true;
            if (login) login.hidden = false;

            pararObservacaoEntregas();
            pararListener(historyUnsubscribe);
            pararListener(chatUnsubscribe);

            historyUnsubscribe = null;
            chatUnsubscribe = null;

            limparMiniMapas();

            return;
        }

        currentUser = user;

        try {
            const doc = await db.collection('users')
                .doc(user.uid)
                .get();

            if (!doc.exists) {
                throw new Error('Perfil do usuário não encontrado.');
            }

            const data = doc.data();

            if (!['vendor', 'driver'].includes(data.role)) {
                throw new Error('Perfil de usuário inválido.');
            }

            currentUserData = data;
            currentRole = data.role;

            abrirAplicacao(data);

        } catch (error) {
            console.error('Erro ao restaurar sessão:', error);

            currentUser = null;
            currentUserData = null;

            await auth.signOut().catch(console.error);

            exibirFeedback(
                'auth-feedback',
                'Não foi possível restaurar sua sessão. Faça login novamente.'
            );
        }
    });
}

// =====================================
// CABEÇALHO
// =====================================

function atualizarCabecalho(viewId) {
    const title = elemento('header-title');
    const subtitle = elemento('header-subtitle');

    if (!title || !subtitle) return;

    const cabecalhos = {
        'sub-vendor-dash': [
            'Painel da Empresa',
            'Gerencie e acompanhe seus pedidos.'
        ],
        'sub-vendor-new': [
            'Nova Solicitação',
            'Cadastre uma nova entrega.'
        ],
        'sub-vendor-track': [
            'Acompanhamento',
            'Acompanhe suas entregas.'
        ],
        'sub-driver-dash': [
            'Entregas Disponíveis',
            'Acompanhe suas solicitações.'
        ],
        'sub-chat-list': [
            'Conversas',
            'Consulte suas conversas.'
        ],
        'sub-chat': [
            'Chat da entrega',
            'Conversa entre empresa e entregador.'
        ],
        'sub-history': [
            'Histórico de Entregas',
            'Consulte suas entregas concluídas.'
        ]
    };

    const dados = cabecalhos[viewId];

    if (dados) {
        title.textContent = dados[0];
        subtitle.textContent = dados[1];
    }
}

// =====================================
// NAVEGAÇÃO
// =====================================

function navigateApp(viewId) {
    limparFeedback('app-feedback');

    const target = elemento(viewId);

    if (!target || !target.classList.contains('view')) {
        console.error(`Tela não encontrada: ${viewId}`);
        return;
    }

    if (viewId !== 'sub-vendor-track') {
        limparMiniMapas();
    }

    document.querySelectorAll('.main-content .view').forEach(view => {
        view.classList.remove('active');
        view.hidden = true;
    });

    target.hidden = false;

    requestAnimationFrame(() => {
        target.classList.add('active');

        if (viewId === 'sub-vendor-track') {
            renderizarAcompanhamentoEmpresa(
                entregasEmpresaAtuais,
                entregaAcompanhamentoId
            );
        }
    });

    document.querySelectorAll('#nav-list button.nav-btn').forEach(btn => {
        const isCurrent = btn.dataset.target === viewId;

        btn.classList.toggle('active', isCurrent);

        if (isCurrent) {
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.removeAttribute('aria-current');
        }
    });

    atualizarCabecalho(viewId);
    closeMobileMenu();
}

// =====================================
// MENU MOBILE
// =====================================

function toggleMobileMenu() {
    const sidebar = elemento('main-sidebar');
    const btn = elemento('menu-toggle-btn');
    const backdrop = elemento('sidebar-backdrop');

    if (!sidebar || !btn) return;

    const isOpen = sidebar.classList.toggle('mobile-active');

    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute(
        'aria-label',
        isOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'
    );

    if (backdrop) backdrop.hidden = !isOpen;

    if (isOpen) {
        sidebar.querySelector('button')?.focus();
    }
}

function closeMobileMenu() {
    const sidebar = elemento('main-sidebar');
    const btn = elemento('menu-toggle-btn');
    const backdrop = elemento('sidebar-backdrop');

    sidebar?.classList.remove('mobile-active');

    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Abrir menu de navegação');
    }

    if (backdrop) backdrop.hidden = true;
}

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;

    const sidebar = elemento('main-sidebar');

    if (sidebar?.classList.contains('mobile-active')) {
        closeMobileMenu();
        elemento('menu-toggle-btn')?.focus();
    }
});

// =====================================
// LOGIN / CADASTRO
// =====================================

function showAuthForm(form) {
    limparFeedback('auth-feedback');

    const login = elemento('login-form');
    const register = elemento('register-form');

    const loginTab = elemento('tab-login');
    const registerTab = elemento('tab-register');

    if (!login || !register) return;

    const isRegister = form === 'register';

    login.hidden = isRegister;
    register.hidden = !isRegister;

    if (loginTab) {
        loginTab.classList.toggle('active-role', !isRegister);
        loginTab.setAttribute('aria-selected', String(!isRegister));
        loginTab.setAttribute('tabindex', isRegister ? '-1' : '0');
    }

    if (registerTab) {
        registerTab.classList.toggle('active-role', isRegister);
        registerTab.setAttribute('aria-selected', String(isRegister));
        registerTab.setAttribute('tabindex', isRegister ? '0' : '-1');
    }
}

// =====================================
// CADASTRO
// =====================================

async function doRegister() {
    limparFeedback('auth-feedback');

    const ids = [
        'register-name',
        'register-email',
        'register-password',
        'register-confirm-password'
    ];

    limparErrosCampos(ids);

    const name = elemento('register-name')?.value.trim() || '';
    const email = elemento('register-email')?.value.trim() || '';
    const password = elemento('register-password')?.value || '';
    const confirmPassword = elemento('register-confirm-password')?.value || '';

    const campos = [
        ['register-name', name, 'Informe seu nome completo.'],
        ['register-email', email, 'Informe seu e-mail.'],
        ['register-password', password, 'Informe uma senha.'],
        ['register-confirm-password', confirmPassword, 'Confirme sua senha.']
    ];

    for (const [id, value, mensagem] of campos) {
        if (!value) {
            marcarCampoInvalido(id, true);
            exibirFeedback('auth-feedback', mensagem);
            elemento(id)?.focus();
            return;
        }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        marcarCampoInvalido('register-email', true);
        exibirFeedback('auth-feedback', 'Informe um e-mail válido.');
        elemento('register-email')?.focus();
        return;
    }

    if (password.length < 6) {
        marcarCampoInvalido('register-password', true);
        exibirFeedback('auth-feedback', 'A senha precisa ter pelo menos 6 caracteres.');
        elemento('register-password')?.focus();
        return;
    }

    if (password !== confirmPassword) {
        marcarCampoInvalido('register-confirm-password', true);
        exibirFeedback('auth-feedback', 'As senhas não coincidem.');
        elemento('register-confirm-password')?.focus();
        return;
    }

    let createdUser = null;

    try {
        const result = await auth.createUserWithEmailAndPassword(
            email,
            password
        );

        createdUser = result.user;

        await createdUser.updateProfile({
            displayName: name
        });

        const telefone = elemento('register-phone')?.value.trim() || '';

        await db.collection('users')
            .doc(createdUser.uid)
            .set({
                name,
                email,
                telefone,
                role: registerRole,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

        await auth.signOut();

        currentUser = null;
        currentUserData = null;

        const mensagem = registerRole === 'vendor'
            ? 'Conta de empresa criada com sucesso! Faça login.'
            : 'Conta de entregador criada com sucesso! Faça login.';

        showAuthForm('login');

        if (elemento('login-email')) {
            elemento('login-email').value = email;
        }

        if (elemento('login-password')) {
            elemento('login-password').value = '';
        }

        registerRole = 'vendor';
        selectRegisterRole('vendor');

        exibirFeedback('auth-feedback', mensagem, 'success');
        elemento('login-password')?.focus();

    } catch (error) {
        console.error('Erro no cadastro:', error);

        const mensagens = {
            'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
            'auth/invalid-email': 'O e-mail informado é inválido.',
            'auth/weak-password': 'A senha é muito fraca.',
            'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.'
        };

        if (createdUser && auth.currentUser) {
            await auth.signOut().catch(console.error);

            exibirFeedback(
                'auth-feedback',
                'Não foi possível salvar o perfil no banco de dados. Entre em contato com o suporte.',
                'error'
            );

            return;
        }

        exibirFeedback(
            'auth-feedback',
            mensagens[error.code] || error.message || 'Não foi possível criar a conta.',
            'error'
        );
    }
}

// =====================================
// PUBLICAR ENTREGA
// =====================================

async function publishDelivery() {
    limparFeedback('app-feedback');

    if (!usuarioAutenticado() || currentRole !== 'vendor') {
        exibirFeedback(
            'app-feedback',
            'Somente empresas autenticadas podem publicar entregas.'
        );
        return;
    }

    const campos = [
        { id: 'pickup-address', label: 'Endereço de retirada' },
        { id: 'delivery-address', label: 'Endereço de destino' },
        { id: 'client-name', label: 'Nome do cliente' },
        { id: 'client-phone', label: 'Telefone do cliente' }
    ];

    limparErrosCampos(campos.map(campo => campo.id));

    for (const campo of campos) {
        const input = elemento(campo.id);

        if (!input || !input.value.trim()) {
            marcarCampoInvalido(campo.id, true);
            exibirFeedback(
                'app-feedback',
                `O campo "${campo.label}" é obrigatório.`
            );
            input?.focus();
            return;
        }
    }

    try {
        const userDoc = await db.collection('users')
            .doc(currentUser.uid)
            .get();

        if (!userDoc.exists || userDoc.data().role !== 'vendor') {
            throw new Error('Conta de empresa não autorizada.');
        }

        const userData = userDoc.data();

        const deliveryData = {
            empresaId: currentUser.uid,
            empresaNome: userData.name || userData.nome || nomeUsuario(),

            retirada: elemento('pickup-address').value.trim(),
            destino: elemento('delivery-address').value.trim(),
            cliente: elemento('client-name').value.trim(),
            telefone: elemento('client-phone').value.trim(),

            instrucoes: elemento('delivery-instructions')?.value.trim() || '',

            entregadorId: null,
            entregadorNome: null,
            entregadorTelefone: null,

            status: 'pendente',

            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('deliveries').add(deliveryData);

        elemento('new-delivery-form')?.reset();

        navigateApp('sub-vendor-dash');

        exibirFeedback(
            'app-feedback',
            'Entrega publicada com sucesso!',
            'success'
        );

    } catch (error) {
        console.error('Erro ao publicar entrega:', error);

        exibirFeedback(
            'app-feedback',
            'Não foi possível publicar a entrega: ' + error.message
        );
    }
}

// =====================================
// ENCERRAR LISTENERS DE ENTREGAS
// =====================================

function pararObservacaoEntregas() {
    unsubscribeDeliveries.forEach(pararListener);
    unsubscribeDeliveries = [];
}

function observarEntregas() {
    pararObservacaoEntregas();

    if (!usuarioAutenticado()) return;

    if (currentRole === 'vendor') {
        observarEntregasEmpresa();
    } else {
        observarEntregasEntregador();
    }
}

// =====================================
// ENTREGAS DA EMPRESA
// =====================================

function observarEntregasEmpresa() {
    const query = db.collection('deliveries')
        .where('empresaId', '==', currentUser.uid);

    const unsubscribe = query.onSnapshot(snapshot => {
        const entregas = [];

        snapshot.forEach(doc => {
            entregas.push({
                id: doc.id,
                ...doc.data()
            });
        });

        entregas.sort((a, b) => {
            return obterMilissegundos(b.createdAt) -
                obterMilissegundos(a.createdAt);
        });

        renderizarEntregasEmpresa(entregas);

    }, error => {
        console.error('Erro ao consultar entregas da empresa:', error);

        exibirFeedback(
            'app-feedback',
            'Não foi possível atualizar as entregas.'
        );
    });

    unsubscribeDeliveries.push(unsubscribe);
}

// =====================================
// MINI MAPAS — LEAFLET
// =====================================

function limparMiniMapas() {
    trackingRenderToken++;

    miniMapsInstances.forEach(map => {
        try {
            map.remove();
        } catch (error) {
            console.warn('Erro ao destruir mini mapa:', error);
        }
    });

    miniMapsInstances.clear();
}

function aguardar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodificarEndereco(endereco) {
    const queryOriginal = String(endereco || '').trim();

    if (!queryOriginal) return null;

    if (geocodeCache.has(queryOriginal)) {
        return geocodeCache.get(queryOriginal);
    }

    try {
        const query = /brasil/i.test(queryOriginal)
            ? queryOriginal
            : `${queryOriginal}, Brasil`;

        const url =
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) return null;

        const results = await response.json();

        if (!Array.isArray(results) || results.length === 0) {
            return null;
        }

        const latitude = Number(results[0].lat);
        const longitude = Number(results[0].lon);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return null;
        }

        const coordenadas = [latitude, longitude];

        geocodeCache.set(queryOriginal, coordenadas);

        return coordenadas;

    } catch (error) {
        console.warn('Erro ao geocodificar endereço:', error);
        return null;
    }
}

async function montarMiniMapasRota(entregas) {
    if (typeof L === 'undefined') {
        console.warn('Leaflet não foi carregado.');
        return;
    }

    limparMiniMapas();

    const token = trackingRenderToken;

    for (const entrega of entregas) {
        if (token !== trackingRenderToken) return;

        const container = elemento(`mini-map-${entrega.id}`);

        if (!container || !container.isConnected) continue;

        const mapa = L.map(container, {
            zoomControl: false,
            attributionControl: true,
            scrollWheelZoom: false
        }).setView([-23.5505, -46.6333], 12);

        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }
        ).addTo(mapa);

        miniMapsInstances.set(entrega.id, mapa);

        const origem = await geocodificarEndereco(entrega.retirada);

        if (token !== trackingRenderToken) return;

        await aguardar(1100);

        const destino = await geocodificarEndereco(entrega.destino);

        if (token !== trackingRenderToken) return;
        if (!container.isConnected) continue;

        const pontos = [];

        if (origem) {
            pontos.push(origem);

            L.circleMarker(origem, {
                radius: 7,
                color: '#105c38',
                fillColor: '#16784B',
                fillOpacity: 1,
                weight: 2
            })
                .bindTooltip(`Retirada: ${entrega.retirada || '-'}`)
                .addTo(mapa);
        }

        if (destino) {
            pontos.push(destino);

            L.circleMarker(destino, {
                radius: 7,
                color: '#0f241a',
                fillColor: '#a83232',
                fillOpacity: 1,
                weight: 2
            })
                .bindTooltip(`Destino: ${entrega.destino || '-'}`)
                .addTo(mapa);
        }

        if (origem && destino) {
            L.polyline(
                [origem, destino],
                {
                    color: '#16784B',
                    weight: 4,
                    opacity: 0.85,
                    dashArray: '6, 6'
                }
            ).addTo(mapa);

            mapa.fitBounds(
                L.latLngBounds([origem, destino]),
                {
                    padding: [24, 24]
                }
            );

        } else if (pontos.length === 1) {
            mapa.setView(pontos[0], 14);

        } else {
            const aviso = document.createElement('span');
            aviso.className = 'mini-map-badge';
            aviso.textContent = 'Endereço não localizado';
            container.appendChild(aviso);
        }

        setTimeout(() => {
            if (
                miniMapsInstances.get(entrega.id) === mapa &&
                container.isConnected
            ) {
                mapa.invalidateSize();
            }
        }, 150);
    }
}

// =====================================
// ESTRUTURA DO ACOMPANHAMENTO
// =====================================

function garantirEstruturaAcompanhamento() {
    const tela = elemento('sub-vendor-track');

    if (!tela) {
        console.error('Tela de acompanhamento não encontrada.');
        return null;
    }

    let lista = elemento('track-delivery-list');

    if (!lista) {
        lista = document.createElement('div');
        lista.id = 'track-delivery-list';
        lista.className = 'track-delivery-list';

        const painel = tela.querySelector('.glass-panel');

        if (painel) {
            painel.appendChild(lista);
        } else {
            tela.appendChild(lista);
        }
    }

    let titulo = elemento('track-selected-title');

    if (!titulo) {
        titulo = document.createElement('h2');
        titulo.id = 'track-selected-title';
        titulo.textContent = 'Etapas da entrega';

        lista.insertAdjacentElement('afterend', titulo);
    }

    let etapas = elemento('track-stepper');

    if (!etapas) {
        etapas = document.createElement('div');
        etapas.id = 'track-stepper';
        etapas.className = 'track-stepper';

        titulo.insertAdjacentElement('afterend', etapas);
    }

    return {
        lista,
        titulo,
        etapas
    };
}

// =====================================
// ACOMPANHAMENTO DA EMPRESA
// =====================================

function acompanharEntrega(deliveryId) {
    if (!deliveryId) return;

    entregaAcompanhamentoId = deliveryId;

    navigateApp('sub-vendor-track');

    requestAnimationFrame(() => {
        renderizarAcompanhamentoEmpresa(
            entregasEmpresaAtuais,
            deliveryId
        );
    });
}

function selecionarEntregaAcompanhamento(deliveryId) {
    if (!deliveryId) return;

    const entrega = entregasEmpresaAtuais.find(
        item => item.id === deliveryId
    );

    if (!entrega) return;

    entregaAcompanhamentoId = deliveryId;

    renderizarAcompanhamentoEmpresa(
        entregasEmpresaAtuais,
        deliveryId
    );
}

function renderizarMiniMapaHTML(entrega) {
    return `
        <div
            id="mini-map-${escaparHTML(entrega.id)}"
            class="mini-map"
            role="region"
            aria-label="Mapa de retirada e destino da entrega para ${escaparHTML(entrega.cliente || 'cliente')}">

            <span class="mini-map-badge">
                ${escaparHTML(formatarStatus(entrega.status))}
            </span>
        </div>
    `;
}

function renderizarEtapasAcompanhamento(entrega) {
    const estrutura = garantirEstruturaAcompanhamento();

    if (!estrutura) return;

    const { titulo, etapas } = estrutura;

    if (!entrega) {
        titulo.textContent = 'Etapas da entrega';

        etapas.innerHTML = `
            <p class="empty-track-msg">
                Nenhuma entrega em andamento selecionada.
            </p>
        `;

        return;
    }

    const status = normalizarStatus(entrega.status);

    const passo1 = true;

    const passo2 = Boolean(
        entrega.entregadorId ||
        [
            'aceita',
            'em_andamento',
            'em_transito',
            'coletado',
            'concluida'
        ].includes(status)
    );

    const passo3 = [
        'em_andamento',
        'em_transito',
        'coletado',
        'concluida'
    ].includes(status);

    const passo4 = status === 'concluida';

    titulo.textContent =
        `Etapas da entrega — ${entrega.cliente || 'Cliente'}`;

    etapas.innerHTML = `
        <ol class="track-steps-list">

            <li class="${passo1 ? 'done' : ''}">
                <strong>1. Solicitação publicada</strong>
                <span>
                    Retirada: ${escaparHTML(entrega.retirada || '-')}
                </span>
            </li>

            <li class="${passo2 ? 'done' : ''}">
                <strong>2. Entregador atribuído</strong>
                <span>
                    ${escaparHTML(
                        entrega.entregadorNome ||
                        'Aguardando aceite de entregador'
                    )}
                </span>
            </li>

            <li class="${passo3 ? 'done' : ''}">
                <strong>3. Entrega em trânsito</strong>
                <span>
                    Destino: ${escaparHTML(entrega.destino || '-')}
                </span>
            </li>

            <li class="${passo4 ? 'done' : ''}">
                <strong>4. Entrega concluída</strong>
                <span>
                    Status: ${escaparHTML(formatarStatus(entrega.status))}
                </span>
            </li>

        </ol>
    `;
}

function renderizarAcompanhamentoEmpresa(
    entregas,
    selecionadaId = null
) {
    const estrutura = garantirEstruturaAcompanhamento();

    if (!estrutura) return;

    const listaEl = estrutura.lista;

    const emAndamento = (entregas || []).filter(
        item => isEntregaEmAndamento(item.status)
    );

    if (!emAndamento.length) {
        limparMiniMapas();

        listaEl.innerHTML = `
            <article class="glass-panel delivery-item track-card-grid">
                <div class="del-info">
                    <h3>Nenhuma entrega em andamento</h3>

                    <p>
                        Todas as entregas ativas da empresa aparecerão aqui.
                    </p>
                </div>
            </article>
        `;

        renderizarEtapasAcompanhamento(null);

        return;
    }

    const ativaId =
        emAndamento.some(item => item.id === selecionadaId)
            ? selecionadaId
            : (
                emAndamento.some(
                    item => item.id === entregaAcompanhamentoId
                )
                    ? entregaAcompanhamentoId
                    : emAndamento[0].id
            );

    entregaAcompanhamentoId = ativaId;

    listaEl.innerHTML = emAndamento.map(entrega => {
        const selecionada = entrega.id === ativaId;

        const entregador = entrega.entregadorNome
            ? `${escaparHTML(entrega.entregadorNome)}${
                entrega.entregadorTelefone
                    ? ` — ${escaparHTML(entrega.entregadorTelefone)}`
                    : ''
            }`
            : 'Aguardando entregador';

        const id = escaparHTML(entrega.id);

        return `
            <article
                class="glass-panel delivery-item track-card-grid
                ${selecionada ? 'selected-track' : ''}"
                data-delivery-id="${id}">

                <div class="del-info">

                    <h3>
                        Cliente: ${escaparHTML(entrega.cliente || 'Não informado')}
                    </h3>

                    <p>
                        <strong>Status:</strong>
                        ${escaparHTML(formatarStatus(entrega.status))}
                    </p>

                    <p>
                        <strong>Retirada:</strong>
                        ${escaparHTML(entrega.retirada || '-')}
                    </p>

                    <p>
                        <strong>Destino:</strong>
                        ${escaparHTML(entrega.destino || '-')}
                    </p>

                    <p>
                        <strong>Entregador:</strong>
                        ${entregador}
                    </p>

                    <div class="del-actions"
                        style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">

                        <button
                            type="button"
                            class="btn-primary"
                            onclick="selecionarEntregaAcompanhamento('${id}')">

                            Selecionar entrega
                        </button>

                        <button
                            type="button"
                            class="btn-glass"
                            onclick="abrirChat('${id}', 'sub-vendor-track')">

                            Abrir conversa
                        </button>

                    </div>
                </div>

                ${renderizarMiniMapaHTML(entrega)}

            </article>
        `;
    }).join('');

    const entregaSelecionada = emAndamento.find(
        item => item.id === ativaId
    ) || emAndamento[0];

    renderizarEtapasAcompanhamento(entregaSelecionada);

    if (!elemento('sub-vendor-track')?.hidden) {
        // Cada entrega recebe seu próprio mini mapa.
        montarMiniMapasRota(emAndamento);
    }
}

// =====================================
// PAINEL DA EMPRESA
// =====================================

function renderizarEntregasEmpresa(entregas) {
    entregasEmpresaAtuais = entregas || [];

    const ativas = entregasEmpresaAtuais.filter(
        item => isEntregaEmAndamento(item.status)
    );

    const pendentesCount = ativas.filter(
        item => normalizarStatus(item.status) === 'pendente'
    ).length;

    const transitoCount = ativas.filter(item => {
        const st = normalizarStatus(item.status);

        return [
            'aceita',
            'em_andamento',
            'em_transito',
            'coletado'
        ].includes(st);
    }).length;

    const hoje = new Date().toLocaleDateString('pt-BR');

    const concluidasHojeCount = entregasEmpresaAtuais.filter(item => {
        if (normalizarStatus(item.status) !== 'concluida') {
            return false;
        }

        if (
            !item.concluidaEm ||
            typeof item.concluidaEm.toDate !== 'function'
        ) {
            return false;
        }

        return item.concluidaEm.toDate().toLocaleDateString('pt-BR') === hoje;
    }).length;

    if (elemento('stat-pending')) {
        elemento('stat-pending').textContent = String(pendentesCount);
    }

    if (elemento('stat-transit')) {
        elemento('stat-transit').textContent = String(transitoCount);
    }

    if (elemento('stat-completed')) {
        elemento('stat-completed').textContent = String(concluidasHojeCount);
    }

    const listaEl = elemento('vendor-delivery-list');

    if (listaEl) {
        if (!ativas.length) {
            listaEl.innerHTML = `
                <article class="glass-panel delivery-item">
                    <div class="del-info">
                        <h3>Nenhuma entrega cadastrada</h3>
                        <p>
                            Suas solicitações aparecerão aqui quando forem cadastradas.
                        </p>
                    </div>
                </article>
            `;

        } else {
            listaEl.innerHTML = ativas.map(entrega => {
                const entregadorTxt = entrega.entregadorNome
                    ? `${escaparHTML(entrega.entregadorNome)}${
                        entrega.entregadorTelefone
                            ? ` — ${escaparHTML(entrega.entregadorTelefone)}`
                            : ''
                    }`
                    : 'Aguardando entregador';

                const id = escaparHTML(entrega.id);

                return `
                    <article class="glass-panel delivery-item">

                        <div class="del-info">

                            <h3>
                                Cliente: ${escaparHTML(entrega.cliente || 'Não informado')}
                            </h3>

                            <p>
                                <strong>Status:</strong>
                                ${escaparHTML(formatarStatus(entrega.status))}
                            </p>

                            <p>
                                <strong>Retirada:</strong>
                                ${escaparHTML(entrega.retirada || '-')}
                            </p>

                            <p>
                                <strong>Destino:</strong>
                                ${escaparHTML(entrega.destino || '-')}
                            </p>

                            <p>
                                <strong>Telefone:</strong>
                                ${escaparHTML(entrega.telefone || '-')}
                            </p>

                            <p>
                                <strong>Entregador:</strong>
                                ${entregadorTxt}
                            </p>

                        </div>

                        <div class="del-actions"
                            style="display:flex;gap:10px;flex-wrap:wrap;">

                            <button
                                type="button"
                                class="btn-primary"
                                onclick="acompanharEntrega('${id}')">

                                Acompanhar
                            </button>

                            <button
                                type="button"
                                class="btn-glass"
                                onclick="abrirChat('${id}', 'sub-vendor-dash')">

                                Abrir conversa
                            </button>

                        </div>

                    </article>
                `;
            }).join('');
        }
    }

    if (
        elemento('sub-vendor-track') &&
        !elemento('sub-vendor-track').hidden
    ) {
        renderizarAcompanhamentoEmpresa(
            entregasEmpresaAtuais,
            entregaAcompanhamentoId
        );
    }
}

// =====================================
// ENTREGAS DO ENTREGADOR
// =====================================

function observarEntregasEntregador() {
    const pendentesMap = new Map();
    const atribuidasMap = new Map();

    function atualizarPainel() {
        const unificadas = new Map([
            ...pendentesMap,
            ...atribuidasMap
        ]);

        const lista = Array.from(unificadas.values());

        lista.sort((a, b) => {
            return obterMilissegundos(b.createdAt) -
                obterMilissegundos(a.createdAt);
        });

        renderizarEntregasMotorista(lista);
    }

    const pendentes = db.collection('deliveries')
        .where('status', '==', 'pendente');

    const unsubscribePending = pendentes.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const id = change.doc.id;

            if (change.type === 'removed') {
                pendentesMap.delete(id);
            } else {
                pendentesMap.set(id, {
                    id,
                    ...change.doc.data()
                });
            }
        });

        atualizarPainel();

    }, error => {
        console.error('Erro nas entregas pendentes:', error);

        exibirFeedback(
            'app-feedback',
            'Não foi possível carregar as entregas disponíveis.'
        );
    });

    const atribuidas = db.collection('deliveries')
        .where('entregadorId', '==', currentUser.uid);

    const unsubscribeAssigned = atribuidas.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const id = change.doc.id;

            if (change.type === 'removed') {
                atribuidasMap.delete(id);
            } else {
                atribuidasMap.set(id, {
                    id,
                    ...change.doc.data()
                });
            }
        });

        atualizarPainel();

    }, error => {
        console.error('Erro nas entregas atribuídas:', error);

        exibirFeedback(
            'app-feedback',
            'Não foi possível carregar suas entregas.'
        );
    });

    unsubscribeDeliveries.push(
        unsubscribePending,
        unsubscribeAssigned
    );
}

function renderizarEntregasMotorista(entregas) {
    const listaEl = elemento('driver-delivery-list');

    if (!listaEl) return;

    const visiveis = (entregas || []).filter(
        item => isEntregaEmAndamento(item.status)
    );

    if (!visiveis.length) {
        listaEl.innerHTML = `
            <article class="glass-panel delivery-item">
                <div class="del-info">
                    <h3>Nenhuma entrega disponível</h3>
                    <p>
                        Novas solicitações aparecerão aqui quando estiverem disponíveis.
                    </p>
                </div>
            </article>
        `;

        return;
    }

    listaEl.innerHTML = visiveis.map(entrega => {
        const st = normalizarStatus(entrega.status);
        const idEscapado = escaparHTML(entrega.id);

        let botoesAcao = '';

        if (st === 'pendente' && !entrega.entregadorId) {
            botoesAcao += `
                <button
                    type="button"
                    class="btn-primary"
                    onclick="aceitarEntrega('${idEscapado}')">
                    Aceitar entrega
                </button>
            `;

        } else if (entrega.entregadorId === currentUser?.uid) {
            if (st === 'aceita') {
                botoesAcao += `
                    <button
                        type="button"
                        class="btn-primary"
                        onclick="atualizarStatusEntrega('${idEscapado}', 'em_andamento')">
                        Iniciar entrega
                    </button>
                `;
            }

            if (st === 'aceita' || st === 'em_andamento') {
                botoesAcao += `
                    <button
                        type="button"
                        class="btn-glass"
                        onclick="concluirEntrega('${idEscapado}')">
                        Concluir entrega
                    </button>
                `;
            }
        }

        if (entrega.entregadorId === currentUser?.uid) {
            botoesAcao += `
                <button
                    type="button"
                    class="btn-glass"
                    onclick="abrirChat('${idEscapado}', 'sub-driver-dash')">
                    Abrir conversa
                </button>
            `;
        }

        return `
            <article class="glass-panel delivery-item">

                <div class="del-info">

                    <h3>
                        Cliente: ${escaparHTML(entrega.cliente || 'Não informado')}
                    </h3>

                    <p>
                        <strong>Empresa:</strong>
                        ${escaparHTML(entrega.empresaNome || '-')}
                    </p>

                    <p>
                        <strong>Status:</strong>
                        ${escaparHTML(formatarStatus(entrega.status))}
                    </p>

                    <p>
                        <strong>Retirada:</strong>
                        ${escaparHTML(entrega.retirada || '-')}
                    </p>

                    <p>
                        <strong>Destino:</strong>
                        ${escaparHTML(entrega.destino || '-')}
                    </p>

                    <p>
                        <strong>Telefone:</strong>
                        ${escaparHTML(entrega.telefone || '-')}
                    </p>

                    ${
                        entrega.instrucoes
                            ? `<p><strong>Instruções:</strong> ${escaparHTML(entrega.instrucoes)}</p>`
                            : ''
                    }

                </div>

                <div class="del-actions"
                    style="display:flex;gap:10px;flex-wrap:wrap;">
                    ${botoesAcao}
                </div>

            </article>
        `;
    }).join('');
}

// =====================================
// ACEITAR ENTREGA
// =====================================

async function aceitarEntrega(deliveryId) {
    if (
        deliveryActionPending ||
        !deliveryId ||
        !usuarioAutenticado()
    ) {
        return;
    }

    if (currentRole !== 'driver') {
        exibirFeedback(
            'app-feedback',
            'Somente entregadores podem aceitar entregas.'
        );
        return;
    }

    deliveryActionPending = true;
    limparFeedback('app-feedback');

    try {
        const perfilSnap = await db.collection('users')
            .doc(currentUser.uid)
            .get();

        if (!perfilSnap.exists) {
            throw new Error('Perfil do entregador não encontrado.');
        }

        const perfil = perfilSnap.data();

        if (perfil.role !== 'driver') {
            throw new Error('Este perfil não está autorizado a aceitar entregas.');
        }

        const nomeEntregador =
            perfil.name ||
            perfil.nome ||
            currentUser.displayName ||
            'Entregador';

        const telefoneEntregador =
            perfil.telefone ||
            perfil.phone ||
            perfil.celular ||
            '';

        const deliveryRef = db.collection('deliveries').doc(deliveryId);

        await db.runTransaction(async transaction => {
            const docSnap = await transaction.get(deliveryRef);

            if (!docSnap.exists) {
                throw new Error('Entrega não encontrada.');
            }

            const dados = docSnap.data();

            if (normalizarStatus(dados.status) !== 'pendente') {
                throw new Error('Esta entrega já foi aceita ou não está disponível.');
            }

            if (dados.entregadorId) {
                throw new Error('Esta entrega já possui um entregador.');
            }

            transaction.update(deliveryRef, {
                entregadorId: currentUser.uid,
                entregadorNome: nomeEntregador,
                entregadorTelefone: telefoneEntregador,
                status: 'aceita',
                aceitaEm: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        exibirFeedback(
            'app-feedback',
            'Entrega aceita com sucesso! Seus dados foram enviados à empresa.',
            'success'
        );

    } catch (error) {
        console.error('Erro ao aceitar entrega:', error);

        exibirFeedback(
            'app-feedback',
            error.message || 'Não foi possível aceitar a entrega.'
        );

    } finally {
        deliveryActionPending = false;
    }
}

// =====================================
// ATUALIZAR STATUS
// =====================================

async function atualizarStatusEntrega(deliveryId, novoStatus) {
    if (
        deliveryActionPending ||
        !deliveryId ||
        !usuarioAutenticado()
    ) {
        return;
    }

    if (
        currentRole !== 'driver' ||
        novoStatus !== 'em_andamento'
    ) {
        exibirFeedback('app-feedback', 'Ação não permitida.');
        return;
    }

    deliveryActionPending = true;
    limparFeedback('app-feedback');

    try {
        const deliveryRef = db.collection('deliveries').doc(deliveryId);

        await db.runTransaction(async transaction => {
            const docSnap = await transaction.get(deliveryRef);

            if (!docSnap.exists) {
                throw new Error('Entrega não encontrada.');
            }

            const dados = docSnap.data();

            if (dados.entregadorId !== currentUser.uid) {
                throw new Error('Você não é o responsável por esta entrega.');
            }

            if (normalizarStatus(dados.status) !== 'aceita') {
                throw new Error('Somente entregas aceitas podem ser iniciadas.');
            }

            transaction.update(deliveryRef, {
                status: 'em_andamento',
                iniciadaEm: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        exibirFeedback(
            'app-feedback',
            'Entrega iniciada com sucesso!',
            'success'
        );

    } catch (error) {
        console.error('Erro ao atualizar status:', error);

        exibirFeedback(
            'app-feedback',
            error.message || 'Não foi possível atualizar o status.'
        );

    } finally {
        deliveryActionPending = false;
    }
}

// =====================================
// CONCLUIR ENTREGA
// =====================================

async function concluirEntrega(deliveryId) {
    if (
        deliveryActionPending ||
        !deliveryId ||
        !usuarioAutenticado()
    ) {
        return;
    }

    if (currentRole !== 'driver') {
        exibirFeedback(
            'app-feedback',
            'Somente entregadores podem concluir entregas.'
        );

        return;
    }

    const confirmar = window.confirm(
        'Deseja realmente registrar esta entrega como concluída?'
    );

    if (!confirmar) return;

    deliveryActionPending = true;
    limparFeedback('app-feedback');

    try {
        const deliveryRef = db.collection('deliveries').doc(deliveryId);

        await db.runTransaction(async transaction => {
            const docSnap = await transaction.get(deliveryRef);

            if (!docSnap.exists) {
                throw new Error('Entrega não encontrada.');
            }

            const dados = docSnap.data();

            if (dados.entregadorId !== currentUser.uid) {
                throw new Error('Você não é o responsável por esta entrega.');
            }

            const st = normalizarStatus(dados.status);

            if (st !== 'em_andamento' && st !== 'aceita') {
                throw new Error('Esta entrega não pode ser concluída neste momento.');
            }

            transaction.update(deliveryRef, {
                status: 'concluida',
                concluidaEm: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        exibirFeedback(
            'app-feedback',
            'Entrega concluída com sucesso!',
            'success'
        );

    } catch (error) {
        console.error('Erro ao concluir entrega:', error);

        exibirFeedback(
            'app-feedback',
            error.message || 'Não foi possível concluir a entrega.'
        );

    } finally {
        deliveryActionPending = false;
    }
}

// =====================================
// HISTÓRICO
// =====================================

function observarHistorico() {
    pararListener(historyUnsubscribe);
    historyUnsubscribe = null;

    if (!usuarioAutenticado()) return;

    const campoFiltro = currentRole === 'vendor'
        ? 'empresaId'
        : 'entregadorId';

    historyUnsubscribe = db.collection('deliveries')
        .where(campoFiltro, '==', currentUser.uid)
        .onSnapshot(snapshot => {
            const concluidas = [];

            snapshot.forEach(doc => {
                const data = doc.data();

                if (normalizarStatus(data.status) === 'concluida') {
                    concluidas.push({
                        id: doc.id,
                        ...data
                    });
                }
            });

            concluidas.sort((a, b) => {
                return obterMilissegundos(
                    b.concluidaEm || b.updatedAt || b.createdAt
                ) - obterMilissegundos(
                    a.concluidaEm || a.updatedAt || a.createdAt
                );
            });

            const listaEl = elemento('history-delivery-list');

            if (!listaEl) return;

            if (!concluidas.length) {
                listaEl.innerHTML = `
                    <article class="glass-panel delivery-item">
                        <div class="del-info">
                            <h3>Nenhuma entrega no histórico</h3>
                            <p>
                                As entregas concluídas aparecerão aqui.
                            </p>
                        </div>
                    </article>
                `;

                return;
            }

            listaEl.innerHTML = concluidas.map(entrega => `
                <article class="glass-panel delivery-item">

                    <div class="del-info">

                        <h3>
                            Cliente: ${escaparHTML(entrega.cliente || 'Não informado')}
                        </h3>

                        <p>
                            <strong>Destino:</strong>
                            ${escaparHTML(entrega.destino || '-')}
                        </p>

                        <p>
                            <strong>Entregador:</strong>
                            ${escaparHTML(entrega.entregadorNome || '-')}
                        </p>

                        <p>
                            <strong>Concluída em:</strong>
                            ${escaparHTML(
                                obterData(entrega.concluidaEm || entrega.updatedAt)
                            )}
                        </p>

                    </div>

                </article>
            `).join('');

        }, error => {
            console.error('Erro ao carregar histórico:', error);

            exibirFeedback(
                'app-feedback',
                'Não foi possível carregar o histórico.'
            );
        });
}

// =====================================
// CHAT
// =====================================

function abrirListaConversas() {
    navigateApp('sub-chat-list');

    const listEl = elemento('chat-list');

    if (!listEl) return;

    if (currentRole === 'vendor') {
        const comConversa = (
            entregasEmpresaAtuais || []
        ).filter(e => Boolean(e.entregadorId));

        if (!comConversa.length) {
            listEl.innerHTML = `
                <p>Nenhuma conversa disponível no momento.</p>
            `;

            return;
        }

        listEl.innerHTML = comConversa.map(entrega => `
            <article class="glass-panel chat-list-item">

                <div class="chat-list-info">

                    <h3>
                        Cliente: ${escaparHTML(entrega.cliente || 'Entrega')}
                    </h3>

                    <p>
                        Entregador: ${escaparHTML(entrega.entregadorNome || '-')}
                    </p>

                </div>

                <button
                    type="button"
                    class="btn-primary"
                    onclick="abrirChat('${escaparHTML(entrega.id)}', 'sub-chat-list')">

                    Abrir conversa
                </button>

            </article>
        `).join('');

    } else {
        listEl.innerHTML = `
            <p>Suas conversas aparecerão aqui.</p>
        `;
    }
}

async function abrirChat(deliveryId, returnView = null) {
    if (!deliveryId || !usuarioAutenticado()) return;

    pararListener(chatUnsubscribe);
    chatUnsubscribe = null;

    currentChatDeliveryId = deliveryId;

    chatReturnView = returnView ||
        (currentRole === 'vendor'
            ? 'sub-vendor-dash'
            : 'sub-driver-dash');

    currentChatDelivery = null;

    navigateApp('sub-chat');

    const messagesEl = elemento('chat-messages');
    const titleEl = elemento('chat-title');
    const subtitleEl = elemento('chat-subtitle');

    if (messagesEl) {
        messagesEl.innerHTML = `
            <p class="chat-empty">Carregando mensagens...</p>
        `;
    }

    try {
        const docSnap = await db.collection('deliveries')
            .doc(deliveryId)
            .get();

        if (!docSnap.exists) {
            throw new Error('Entrega não encontrada.');
        }

        currentChatDelivery = {
            id: docSnap.id,
            ...docSnap.data()
        };

        if (titleEl) {
            titleEl.textContent =
                `Conversa — ${currentChatDelivery.cliente || 'Entrega'}`;
        }

        if (subtitleEl) {
            subtitleEl.textContent =
                `Empresa: ${currentChatDelivery.empresaNome || '-'} | Entregador: ${currentChatDelivery.entregadorNome || 'Aguardando'}`;
        }

        const pertenceAoUsuario =
            currentRole === 'vendor'
                ? currentChatDelivery.empresaId === currentUser.uid
                : currentChatDelivery.entregadorId === currentUser.uid;

        if (!pertenceAoUsuario) {
            throw new Error('Você não tem acesso a esta conversa.');
        }

    } catch (error) {
        console.error('Erro ao carregar dados da entrega no chat:', error);

        if (messagesEl) {
            messagesEl.innerHTML = `
                <p class="chat-empty">
                    Não foi possível abrir esta conversa.
                </p>
            `;
        }

        exibirFeedback(
            'app-feedback',
            error.message || 'Não foi possível abrir a conversa.'
        );

        return;
    }

    const chatIdAtual = deliveryId;

    chatUnsubscribe = db.collection('deliveries')
        .doc(deliveryId)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(snapshot => {
            if (
                currentChatDeliveryId !== chatIdAtual ||
                !messagesEl
            ) {
                return;
            }

            if (snapshot.empty) {
                messagesEl.innerHTML = `
                    <p class="chat-empty">
                        Nenhuma mensagem ainda. Envie a primeira mensagem.
                    </p>
                `;

                return;
            }

            messagesEl.innerHTML = snapshot.docs.map(doc => {
                const msg = doc.data();

                const isMine =
                    msg.senderId === currentUser?.uid;

                const hora =
                    msg.createdAt &&
                    typeof msg.createdAt.toDate === 'function'
                        ? msg.createdAt.toDate().toLocaleTimeString(
                            'pt-BR',
                            {
                                hour: '2-digit',
                                minute: '2-digit'
                            }
                        )
                        : '';

                return `
                    <div class="chat-message ${isMine ? 'mine' : 'theirs'}">

                        <span class="chat-message-author">
                            ${escaparHTML(msg.senderName || 'Usuário')}
                        </span>

                        <p>
                            ${escaparHTML(msg.text || '')}
                        </p>

                        <time>
                            ${escaparHTML(hora)}
                        </time>

                    </div>
                `;
            }).join('');

            messagesEl.scrollTop = messagesEl.scrollHeight;

        }, error => {
            console.error('Erro ao ouvir mensagens do chat:', error);

            exibirFeedback(
                'app-feedback',
                'Não foi possível atualizar as mensagens.'
            );
        });
}

function fecharChat() {
    pararListener(chatUnsubscribe);

    chatUnsubscribe = null;
    currentChatDeliveryId = null;
    currentChatDelivery = null;

    const destino = chatReturnView ||
        (currentRole === 'vendor'
            ? 'sub-vendor-dash'
            : 'sub-driver-dash');

    chatReturnView = null;

    navigateApp(destino);
}

// =====================================
// ENVIO DE MENSAGENS
// =====================================

function iniciarChatForm() {
    const chatForm = elemento('chat-form');

    if (!chatForm || chatForm.dataset.initialized === 'true') {
        return;
    }

    chatForm.dataset.initialized = 'true';

    chatForm.addEventListener('submit', async event => {
        event.preventDefault();

        if (
            chatSending ||
            !currentChatDeliveryId ||
            !usuarioAutenticado()
        ) {
            return;
        }

        const input = elemento('chat-input');
        const texto = input?.value.trim() || '';

        if (!texto) return;

        if (!currentChatDelivery) {
            exibirFeedback(
                'app-feedback',
                'Não foi possível identificar a entrega.'
            );

            return;
        }

        chatSending = true;

        try {
            const deliveryId = currentChatDeliveryId;

            const pertenceAoUsuario =
                currentRole === 'vendor'
                    ? currentChatDelivery.empresaId === currentUser.uid
                    : currentChatDelivery.entregadorId === currentUser.uid;

            if (!pertenceAoUsuario) {
                throw new Error('Você não tem autorização para enviar mensagens.');
            }

            await db.collection('deliveries')
                .doc(deliveryId)
                .collection('messages')
                .add({
                    senderId: currentUser.uid,
                    senderName: nomeUsuario(),
                    senderRole: currentRole,
                    text: texto,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

            if (
                input &&
                currentChatDeliveryId === deliveryId
            ) {
                input.value = '';
            }

        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);

            exibirFeedback(
                'app-feedback',
                error.message || 'Não foi possível enviar a mensagem.'
            );

        } finally {
            chatSending = false;
        }
    });
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
    limparMiniMapas();

    pararObservacaoEntregas();
    pararListener(historyUnsubscribe);
    pararListener(chatUnsubscribe);

    historyUnsubscribe = null;
    chatUnsubscribe = null;

    entregasEmpresaAtuais = [];
    entregaAcompanhamentoId = null;

    currentChatDeliveryId = null;
    currentChatDelivery = null;
    chatReturnView = null;

    currentUser = null;
    currentUserData = null;

    closeMobileMenu();

    try {
        await auth.signOut();
    } catch (error) {
        console.error('Erro ao sair:', error);

        exibirFeedback(
            'auth-feedback',
            'Não foi possível encerrar a sessão.'
        );
    }

    const app = elemento('view-app');
    const login = elemento('view-login');

    if (app) app.hidden = true;
    if (login) login.hidden = false;

    showAuthForm('login');
}

// =====================================
// INICIALIZAÇÃO
// =====================================

document.addEventListener('DOMContentLoaded', () => {
    iniciarAutenticacao();
    iniciarChatForm();

    const backdrop = elemento('sidebar-backdrop');

    if (backdrop) {
        backdrop.addEventListener('click', closeMobileMenu);
    }
});
