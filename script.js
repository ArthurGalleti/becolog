
/* =========================================
   BECOLOG — SCRIPT PRINCIPAL
   Firebase Authentication + Firestore
   Acessibilidade
   Entregas em tempo real
   Identificação do entregador
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

    document.querySelectorAll('.main-content .view').forEach(view => {
        view.classList.remove('active');
        view.hidden = true;
    });

    target.hidden = false;

    requestAnimationFrame(() => {
        target.classList.add('active');
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
            exibirFeedback(
                'auth-feedback',
                'A conta de autenticação foi criada, mas não foi possível salvar o perfil no Firestore. Verifique as regras do banco de dados.',
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

// =====================================
// ACEITAR ENTREGA
// =====================================

async function aceitarEntrega(deliveryId) {
    if (deliveryActionPending || !deliveryId || !usuarioAutenticado()) {
        return;
    }

    if (currentRole !== 'driver') {
        exibirFeedback('app-feedback', 'Somente entregadores podem aceitar entregas.');
        return;
    }

    deliveryActionPending = true;
    limparFeedback('app-feedback');

    try {
        // Busca os dados do perfil do entregador.
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
// ATUALIZAR STATUS DA ENTREGA
// =====================================

async function atualizarStatusEntrega(deliveryId, novoStatus) {
    if (deliveryActionPending || !deliveryId || !usuarioAutenticado()) {
        return;
    }

    if (currentRole !== 'driver' || novoStatus !== 'em_andamento') {
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
    if (deliveryActionPending || !deliveryId || !usuarioAutenticado()) {
        return;
    }

    if (currentRole !== 'driver') {
        exibirFeedback('app-feedback', 'Somente entregadores podem concluir entregas.');
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

            if (normalizarStatus(dados.status) !== 'em_andamento') {
                throw new Error('Somente entregas em andamento podem ser concluídas.');
            }

            transaction.update(deliveryRef, {
                status: 'concluida',
                concluidaEm: firebase.firestore.FieldValue.serverTimestamp(),
                concluidaPor: currentUser.uid,
                entregadorNome: dados.entregadorNome || nomeUsuario(),
                entregadorTelefone: dados.entregadorTelefone || telefoneUsuario(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        exibirFeedback(
            'app-feedback',
            'Entrega concluída e salva no histórico com sucesso!',
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

function pararObservacaoHistorico() {
    if (historyUnsubscribe) {
        historyUnsubscribe();
        historyUnsubscribe = null;
    }
}

function observarHistorico() {
    pararObservacaoHistorico();

    if (!usuarioAutenticado()) return;

    const campoFiltro = currentRole === 'driver'
        ? 'entregadorId'
        : 'empresaId';

    historyUnsubscribe = db.collection('deliveries')
        .where(campoFiltro, '==', currentUser.uid)
        .where('status', '==', 'concluida')
        .onSnapshot(snapshot => {
            const concluidas = [];

            snapshot.forEach(doc => {
                concluidas.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            concluidas.sort((a, b) => {
                const dataA = obterMilissegundos(a.concluidaEm) ||
                    obterMilissegundos(a.updatedAt);

                const dataB = obterMilissegundos(b.concluidaEm) ||
                    obterMilissegundos(b.updatedAt);

                return dataB - dataA;
            });

            renderizarHistorico(concluidas);

        }, error => {
            console.error('Erro ao observar histórico:', error);

            exibirFeedback(
                'app-feedback',
                'Não foi possível carregar o histórico. Verifique as permissões do Firestore.'
            );
        });
}

function renderizarHistorico(listaConcluidas) {
    const container = elemento('history-delivery-list');
    if (!container) return;

    if (listaConcluidas.length === 0) {
        container.innerHTML = `
            <article class="glass-panel delivery-item">
                <div class="del-info">
                    <h3>Nenhuma entrega concluída</h3>
                    <p>As entregas finalizadas aparecerão registradas aqui.</p>
                </div>
            </article>
        `;
        return;
    }

    container.innerHTML = listaConcluidas.map(entrega => `
        <article class="glass-panel delivery-item">
            <div class="del-info">
                <span class="status-badge status-concluida">
                    Concluída
                </span>

                <h3>Entrega #${escaparHTML(entrega.id.substring(0, 6))}</h3>

                <p><strong>Cliente:</strong>
                    ${escaparHTML(entrega.cliente || 'Não informado')}
                </p>

                <p><strong>Retirada:</strong>
                    ${escaparHTML(entrega.retirada || 'Não informado')}
                </p>

                <p><strong>Destino:</strong>
                    ${escaparHTML(entrega.destino || 'Não informado')}
                </p>

                <p><strong>Concluída em:</strong>
                    ${escaparHTML(obterData(entrega.concluidaEm || entrega.updatedAt))}
                </p>

                ${currentRole === 'driver' ? `
                    <p><strong>Empresa:</strong>
                        ${escaparHTML(entrega.empresaNome || 'Não informado')}
                    </p>
                ` : `
                    <p><strong>Entregador:</strong>
                        ${escaparHTML(entrega.entregadorNome || 'Não informado')}
                    </p>

                    <p><strong>Telefone do entregador:</strong>
                        ${escaparHTML(entrega.entregadorTelefone || 'Não informado')}
                    </p>
                `}
            </div>
        </article>
    `).join('');
}

// =====================================
// RENDERIZAR ENTREGAS DA EMPRESA
// =====================================

function renderizarEntregasEmpresa(entregas) {
    const container = elemento('vendor-delivery-list');
    if (!container) return;

    const ativas = entregas.filter(entrega => {
        return !['concluida', 'cancelada'].includes(
            normalizarStatus(entrega.status)
        );
    });

    if (ativas.length === 0) {
        container.innerHTML = `
            <article class="glass-panel delivery-item">
                <div class="del-info">
                    <h3>Nenhuma entrega ativa</h3>
                    <p>Suas solicitações aparecerão aqui quando forem cadastradas.</p>
                </div>
            </article>
        `;
    } else {
        container.innerHTML = ativas.map(entrega => {
            const status = normalizarStatus(entrega.status);
            const entregadorDefinido = Boolean(entrega.entregadorId);

            return `
                <article class="glass-panel delivery-item">
                    <div class="del-info">
                        <h3>Entrega #${escaparHTML(entrega.id.substring(0, 6))}</h3>

                        <p><strong>Cliente:</strong>
                            ${escaparHTML(entrega.cliente || 'Não informado')}
                        </p>

                        <p><strong>Retirada:</strong>
                            ${escaparHTML(entrega.retirada || 'Não informado')}
                        </p>

                        <p><strong>Destino:</strong>
                            ${escaparHTML(entrega.destino || 'Não informado')}
                        </p>

                        <p><strong>Telefone do cliente:</strong>
                            ${escaparHTML(entrega.telefone || 'Não informado')}
                        </p>

                        <p><strong>Status:</strong>
                            ${escaparHTML(formatarStatus(entrega.status))}
                        </p>

                        <p><strong>Data:</strong>
                            ${escaparHTML(obterData(entrega.createdAt))}
                        </p>

                        ${entrega.instrucoes ? `
                            <p><strong>Instruções:</strong>
                                ${escaparHTML(entrega.instrucoes)}
                            </p>
                        ` : ''}

                        ${entregadorDefinido ? `
                            <div class="glass-panel driver-assignment"
                                style="margin-top:14px;padding:14px;">

                                <h4>Entregador responsável</h4>

                                <p>
                                    <strong>Nome:</strong>
                                    ${escaparHTML(entrega.entregadorNome || 'Nome não informado')}
                                </p>

                                <p>
                                    <strong>Telefone:</strong>
                                    ${escaparHTML(entrega.entregadorTelefone || 'Não informado')}
                                </p>

                                <p>
                                    <strong>Situação:</strong>
                                    ${status === 'aceita'
                                        ? 'Aceitou a solicitação.'
                                        : status === 'em_andamento'
                                            ? 'Está realizando a entrega.'
                                            : 'Responsável pela entrega.'}
                                </p>

                                <button type="button"
                                    class="btn-primary"
                                    onclick="abrirChat('${escaparHTML(entrega.id)}')">
                                    Abrir conversa
                                </button>
                            </div>
                        ` : `
                            <p class="delivery-waiting">
                                <strong>Entregador:</strong>
                                Aguardando um entregador aceitar esta solicitação.
                            </p>
                        `}
                    </div>
                </article>
            `;
        }).join('');
    }

    const pendentes = entregas.filter(e =>
        normalizarStatus(e.status) === 'pendente'
    ).length;

    const transito = entregas.filter(e =>
        ['aceita', 'em_andamento'].includes(normalizarStatus(e.status))
    ).length;

    const hoje = new Date();

    const concluidas = entregas.filter(e => {
        if (normalizarStatus(e.status) !== 'concluida') return false;

        const timestamp = e.concluidaEm || e.updatedAt;

        return timestamp?.toDate &&
            timestamp.toDate().toDateString() === hoje.toDateString();
    }).length;

    if (elemento('stat-pending')) {
        elemento('stat-pending').textContent = pendentes;
    }

    if (elemento('stat-transit')) {
        elemento('stat-transit').textContent = transito;
    }

    if (elemento('stat-completed')) {
        elemento('stat-completed').textContent = concluidas;
    }
}

// =====================================
// RENDERIZAR ENTREGAS DO ENTREGADOR
// =====================================

function renderizarEntregasMotorista(entregas) {
    const container = elemento('driver-delivery-list');
    if (!container || !currentUser) return;

    const ativas = entregas.filter(item => {
        const status = normalizarStatus(item.status);

        if (['concluida', 'cancelada'].includes(status)) {
            return false;
        }

        if (status === 'pendente') {
            return !item.entregadorId;
        }

        return item.entregadorId === currentUser.uid;
    });

    if (ativas.length === 0) {
        container.innerHTML = `
            <article class="glass-panel delivery-item">
                <div class="del-info">
                    <h3>Nenhuma entrega disponível</h3>
                    <p>Novas solicitações aparecerão aqui quando estiverem disponíveis.</p>
                </div>
            </article>
        `;
        return;
    }

    container.innerHTML = ativas.map(entrega => {
        const minhaEntrega = entrega.entregadorId === currentUser.uid;
        const status = normalizarStatus(entrega.status);

        let botoesAcao = '';

        if (!minhaEntrega && status === 'pendente') {
            botoesAcao = `
                <button type="button"
                    class="btn-primary"
                    onclick="aceitarEntrega('${escaparHTML(entrega.id)}')">
                    Aceitar entrega
                </button>
            `;
        } else if (minhaEntrega && status === 'aceita') {
            botoesAcao = `
                <button type="button"
                    class="btn-glass"
                    onclick="abrirChat('${escaparHTML(entrega.id)}')">
                    Conversar
                </button>

                <button type="button"
                    class="btn-primary"
                    onclick="atualizarStatusEntrega('${escaparHTML(entrega.id)}', 'em_andamento')">
                    Iniciar entrega
                </button>
            `;
        } else if (minhaEntrega && status === 'em_andamento') {
            botoesAcao = `
                <button type="button"
                    class="btn-glass"
                    onclick="abrirChat('${escaparHTML(entrega.id)}')">
                    Conversar
                </button>

                <button type="button"
                    class="btn-primary"
                    onclick="concluirEntrega('${escaparHTML(entrega.id)}')">
                    Registrar como concluída
                </button>
            `;
        }

        return `
            <article class="glass-panel delivery-item">
                <div class="del-info">
                    <h3>
                        ${minhaEntrega ? 'Minha entrega' : 'Nova entrega'}
                        #${escaparHTML(entrega.id.substring(0, 6))}
                    </h3>

                    <p><strong>Empresa:</strong>
                        ${escaparHTML(entrega.empresaNome || 'Não informado')}
                    </p>

                    <p><strong>Cliente:</strong>
                        ${escaparHTML(entrega.cliente || 'Não informado')}
                    </p>

                    <p><strong>Retirada:</strong>
                        ${escaparHTML(entrega.retirada || 'Não informado')}
                    </p>

                    <p><strong>Destino:</strong>
                        ${escaparHTML(entrega.destino || 'Não informado')}
                    </p>

                    <p><strong>Status:</strong>
                        ${escaparHTML(formatarStatus(entrega.status))}
                    </p>

                    <p><strong>Data:</strong>
                        ${escaparHTML(obterData(entrega.createdAt))}
                    </p>

                    ${entrega.instrucoes ? `
                        <p><strong>Instruções:</strong>
                            ${escaparHTML(entrega.instrucoes)}
                        </p>
                    ` : ''}

                    <div class="del-actions"
                        style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        ${botoesAcao}
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

// =====================================
// LISTA DE CONVERSAS
// =====================================

async function abrirListaConversas() {
    if (!usuarioAutenticado()) return;

    navigateApp('sub-chat-list');

    const container = elemento('chat-list');
    if (!container) return;

    container.innerHTML = '<p>Carregando conversas...</p>';

    try {
        let query = db.collection('deliveries');

        if (currentRole === 'vendor') {
            query = query.where('empresaId', '==', currentUser.uid);
        } else {
            query = query.where('entregadorId', '==', currentUser.uid);
        }

        const snapshot = await query.get();

        const conversas = [];

        snapshot.forEach(doc => {
            const data = doc.data();

            if (data.entregadorId) {
                conversas.push({
                    id: doc.id,
                    ...data
                });
            }
        });

        conversas.sort((a, b) => {
            return obterMilissegundos(b.updatedAt) -
                obterMilissegundos(a.updatedAt);
        });

        if (conversas.length === 0) {
            container.innerHTML = '<p>Nenhuma conversa disponível no momento.</p>';
            return;
        }

        container.innerHTML = conversas.map(c => `
            <article class="glass-panel chat-list-item">
                <div class="chat-list-info">
                    <h3>Entrega #${escaparHTML(c.id.substring(0, 6))}</h3>

                    <p><strong>Cliente:</strong>
                        ${escaparHTML(c.cliente || 'Não informado')}
                    </p>

                    <p><strong>Status:</strong>
                        ${escaparHTML(formatarStatus(c.status))}
                    </p>

                    ${currentRole === 'vendor' ? `
                        <p><strong>Entregador:</strong>
                            ${escaparHTML(c.entregadorNome || 'Não informado')}
                        </p>
                    ` : ''}
                </div>

                <button type="button"
                    class="btn-primary"
                    onclick="abrirChat('${escaparHTML(c.id)}')">
                    Abrir chat
                </button>
            </article>
        `).join('');

    } catch (error) {
        console.error('Erro ao listar conversas:', error);

        container.innerHTML = '<p>Erro ao carregar conversas. Tente novamente.</p>';
    }
}

// =====================================
// ABRIR CHAT
// =====================================

async function abrirChat(deliveryId) {
    if (!deliveryId || !usuarioAutenticado()) return;

    if (chatUnsubscribe) {
        pararListener(chatUnsubscribe);
        chatUnsubscribe = null;
    }

    currentChatDeliveryId = deliveryId;
    currentChatDelivery = null;

    chatReturnView = currentRole === 'vendor'
        ? 'sub-vendor-dash'
        : 'sub-driver-dash';

    navigateApp('sub-chat');

    const titleEl = elemento('chat-title');
    const subEl = elemento('chat-subtitle');
    const messagesEl = elemento('chat-messages');

    if (titleEl) {
        titleEl.textContent = `Chat da entrega #${deliveryId.substring(0, 6)}`;
    }

    if (subEl) subEl.textContent = 'Carregando conversa...';

    if (messagesEl) {
        messagesEl.innerHTML = '<p class="chat-empty">Carregando mensagens...</p>';
    }

    try {
        const docSnap = await db.collection('deliveries')
            .doc(deliveryId)
            .get();

        if (currentChatDeliveryId !== deliveryId) return;

        if (!docSnap.exists) {
            throw new Error('Entrega não encontrada.');
        }

        const dados = docSnap.data();

        const ehEmpresa = dados.empresaId === currentUser.uid;
        const ehEntregador = dados.entregadorId === currentUser.uid;

        if (!ehEmpresa && !ehEntregador) {
            throw new Error('Você não tem permissão para acessar esta conversa.');
        }

        currentChatDelivery = {
            id: docSnap.id,
            ...dados
        };

        if (subEl) {
            subEl.textContent = `Cliente: ${dados.cliente || 'Não informado'}`;
        }

        observarMensagensChat(deliveryId);

        elemento('chat-title')?.focus();

    } catch (error) {
        console.error('Erro ao abrir chat:', error);

        if (currentChatDeliveryId === deliveryId && messagesEl) {
            messagesEl.innerHTML = `
                <p class="chat-empty">
                    ${escaparHTML(error.message || 'Erro ao carregar a conversa.')}
                </p>
            `;
        }
    }
}

// =====================================
// OBSERVAR MENSAGENS
// =====================================

function observarMensagensChat(deliveryId) {
    if (chatUnsubscribe) {
        pararListener(chatUnsubscribe);
        chatUnsubscribe = null;
    }

    const messagesContainer = elemento('chat-messages');
    if (!messagesContainer) return;

    chatUnsubscribe = db.collection('deliveries')
        .doc(deliveryId)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(snapshot => {
            if (currentChatDeliveryId !== deliveryId) return;

            if (snapshot.empty) {
                messagesContainer.innerHTML = `
                    <p class="chat-empty">
                        Nenhuma mensagem ainda. Inicie a conversa!
                    </p>
                `;
                return;
            }

            const mensagens = [];

            snapshot.forEach(doc => {
                mensagens.push(doc.data());
            });

            messagesContainer.innerHTML = mensagens.map(msg => {
                const mine = msg.senderId === currentUser.uid;
                const cssClass = mine ? 'mine' : 'theirs';

                const timeStr = msg.createdAt?.toDate
                    ? obterData(msg.createdAt)
                    : 'Enviando...';

                return `
                    <div class="chat-message ${cssClass}">
                        <span class="chat-message-author">
                            ${escaparHTML(msg.senderName || 'Usuário')}
                        </span>

                        <p>${escaparHTML(msg.text || '')}</p>

                        <time>${escaparHTML(timeStr)}</time>
                    </div>
                `;
            }).join('');

            messagesContainer.scrollTop = messagesContainer.scrollHeight;

        }, error => {
            console.error('Erro ao observar mensagens:', error);

            if (currentChatDeliveryId === deliveryId) {
                messagesContainer.innerHTML = `
                    <p class="chat-empty">
                        Erro ao carregar mensagens.
                    </p>
                `;
            }
        });
}

// =====================================
// ENVIAR MENSAGEM
// =====================================

const chatForm = elemento('chat-form');

if (chatForm) {
    chatForm.addEventListener('submit', async event => {
        event.preventDefault();

        if (
            chatSending ||
            !currentChatDeliveryId ||
            !currentChatDelivery ||
            !usuarioAutenticado()
        ) {
            return;
        }

        const input = elemento('chat-input');
        const sendButton = elemento('chat-send');

        const mensagem = input?.value.trim() || '';

        if (!mensagem) {
            input?.focus();
            return;
        }

        if (mensagem.length > 2000) {
            exibirFeedback(
                'app-feedback',
                'A mensagem ultrapassa o limite de 2.000 caracteres.'
            );
            return;
        }

        const ehEmpresa =
            currentChatDelivery.empresaId === currentUser.uid;

        const ehEntregador =
            currentChatDelivery.entregadorId === currentUser.uid;

        if (!ehEmpresa && !ehEntregador) {
            exibirFeedback(
                'app-feedback',
                'Você não tem permissão para enviar mensagens nesta conversa.'
            );
            return;
        }

        const deliveryId = currentChatDeliveryId;

        chatSending = true;

        if (input) input.disabled = true;
        if (sendButton) sendButton.disabled = true;

        try {
            await db.collection('deliveries')
                .doc(deliveryId)
                .collection('messages')
                .add({
                    text: mensagem,
                    senderId: currentUser.uid,
                    senderName: nomeUsuario(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

            if (currentChatDeliveryId === deliveryId && input) {
                input.value = '';
            }

        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);

            exibirFeedback(
                'app-feedback',
                'Não foi possível enviar a mensagem. Verifique sua conexão e permissões.'
            );

        } finally {
            chatSending = false;

            if (input) {
                input.disabled = false;

                if (currentChatDeliveryId === deliveryId) {
                    input.focus();
                }
            }

            if (sendButton) {
                sendButton.disabled = false;
            }
        }
    });
}

// =====================================
// FECHAR CHAT
// =====================================

function fecharChat() {
    if (chatUnsubscribe) {
        pararListener(chatUnsubscribe);
        chatUnsubscribe = null;
    }

    currentChatDeliveryId = null;
    currentChatDelivery = null;

    navigateApp(
        chatReturnView ||
        (currentRole === 'vendor'
            ? 'sub-vendor-dash'
            : 'sub-driver-dash')
    );
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
    try {
        pararObservacaoEntregas();
        pararObservacaoHistorico();

        if (chatUnsubscribe) {
            pararListener(chatUnsubscribe);
            chatUnsubscribe = null;
        }

        currentChatDeliveryId = null;
        currentChatDelivery = null;
        chatReturnView = null;

        chatSending = false;
        deliveryActionPending = false;

        await auth.signOut();

        currentUser = null;
        currentUserData = null;

        const app = elemento('view-app');
        const loginView = elemento('view-login');

        if (app) app.hidden = true;

        if (loginView) {
            loginView.hidden = false;
            loginView.classList.add('active');
        }

        const userName = elemento('user-name');

        if (userName) {
            userName.textContent = '';
            userName.hidden = true;
        }

        const navList = elemento('nav-list');
        if (navList) navList.innerHTML = '';

        closeMobileMenu();
        showAuthForm('login');

        elemento('login-form')?.reset();

        limparFeedback('auth-feedback');
        limparFeedback('app-feedback');

        elemento('login-email')?.focus();

    } catch (error) {
        console.error('Erro ao sair:', error);

        exibirFeedback(
            'app-feedback',
            'Não foi possível encerrar a sessão. Tente novamente.'
        );
    }
}
