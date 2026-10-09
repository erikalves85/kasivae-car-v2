// ============================================================================
// 1. CONFIGURAÇÃO SUPABASE
// ============================================================================
const SUPABASE_URL = 'https://koqgsoclzdoyblhzoeld.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcWdzb2NsemRveWJsaHpvZWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MjgwNjAsImV4cCI6MjEwNjIwNDA2MH0.ffr8ttDKPmBHZsIwOxxSoqcCgn5ClvSSZoQdxAjRC5U';

let supabaseClient = null;
if (window.supabase) {
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (err) {
        console.error('Erro ao inicializar Supabase:', err);
    }
}

// ============================================================================
// 2. ESTADO GLOBAL DO SISTEMA
// ============================================================================
let sessionAtual = null;
let perfilLogado = null; 
let isSuperAdmin = false;

let catalogoCache = [];
let ordensPendenteCache = [];
let equipeCache = [];
let itensNovaEntradaSelecionados = [];

let caixaAtual = null;
let editandoCatalogoId = null;
let editandoUsuarioId = null;

// ============================================================================
// 3. AUTENTICAÇÃO E SESSÃO
// ============================================================================
if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        sessionAtual = session;
        const modalAuth = document.getElementById('modal-autenticacao');
        
        if (session) {
            await carregarPerfilUsuario(session.user.id);
            if (modalAuth) modalAuth.classList.add('hidden');
            
            if (isSuperAdmin) {
                navegarPara('super-admin');
            } else {
                inicializarModulosOperacionais();
                verificarAlertaHorarioCaixa();
            }
        } else {
            perfilLogado = null;
            isSuperAdmin = false;
            if (modalAuth) modalAuth.classList.remove('hidden');
        }
    });
}

async function handleLoginSystem(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const senha = document.getElementById('auth-senha').value;
    const msg = document.getElementById('auth-mensagem-login');

    if (msg) msg.classList.add('hidden');

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    if (error) {
        if (msg) {
            msg.innerText = 'Credenciais inválidas. Verifique o email e a palavra-passe.';
            msg.classList.remove('hidden');
        }
    }
}

async function carregarPerfilUsuario(userId) {
    const emailUser = sessionAtual?.user?.email || '';
    if (emailUser.toLowerCase() === 'admin@kasivaecar.com') {
        isSuperAdmin = true;
        perfilLogado = { perfil: 'super_admin', nome_completo: 'Super Administrador' };
        
        document.getElementById('menu-super-admin-group').classList.remove('hidden');
        document.getElementById('menu-operacional-group').classList.add('hidden');
        document.getElementById('user-badge-name').innerText = 'Super Master';
        return;
    }

    const { data } = await supabaseClient.from('profiles').select('*, tenants ( nome_fantasia )').eq('id', userId).single();
    if (!data) { 
        perfilLogado = { id: userId, tenant_id: null, perfil: 'admin', nome_completo: emailUser };
    } else {
        perfilLogado = data;
    }
    
    isSuperAdmin = false;
    
    document.getElementById('menu-super-admin-group').classList.add('hidden');
    document.getElementById('menu-operacional-group').classList.remove('hidden');
    
    alterarPerfilSimulacao(perfilLogado.perfil);
    const badge = document.getElementById('user-badge-name');
    if (badge && perfilLogado.tenants) badge.innerText = perfilLogado.tenants.nome_fantasia;
    else if (badge) badge.innerText = 'Lava-Rápido';
}

async function efetuarLogout() {
    if (confirm('Deseja encerrar a sessão?')) {
        await supabaseClient.auth.signOut();
        localStorage.clear();
        window.location.reload();
    }
}

// ALERTA DE HORÁRIO DE FECHAMENTO DE CAIXA (Ex: 18:00)
function verificarAlertaHorarioCaixa() {
    const agora = new Date();
    const hora = agora.getHours();
    // Se forem 18h ou mais e houver caixa aberto, dá o alerta
    if (hora >= 18 && caixaAtual) {
        if (!localStorage.getItem('alerta_caixa_18h_' + agora.toDateString())) {
            alert('⚠️ ATENÇÃO: Já passou das 18:00! Lembre-se de conferir o movimento, realizar a sangria e efetuar o encerramento do caixa do dia.');
            localStorage.setItem('alerta_caixa_18h_' + agora.toDateString(), 'true');
        }
    }
}

// ============================================================================
// 4. UTILITÁRIOS E NAVEGAÇÃO
// ============================================================================
function formatarBRL(val) {
    return (parseFloat(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataHora(dataIso) {
    if (!dataIso) return '-';
    const d = new Date(dataIso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function navegarPara(telaId) {
    document.querySelectorAll('.view-screen').forEach(el => el.classList.add('hidden'));
    const targetScreen = document.getElementById(`screen-${telaId}`);
    if (targetScreen) targetScreen.classList.remove('hidden');

    if (telaId === 'super-admin') carregarMasterTenants();
    if (telaId === 'acompanhamento') carregarKanban();
    if (telaId === 'caixa') carregarEstadoCaixa();
    if (telaId === 'historico-passagens') carregarHistoricoPassagens();
    if (telaId === 'relatorios' || telaId === 'financeiro') carregarModuloFinanceiro();
    if (telaId === 'usuarios') carregarUsuariosUI();
}

function alterarPerfilSimulacao(role) {
    if (isSuperAdmin) return;
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const rolesPermitidas = btn.getAttribute('data-roles');
        if (!rolesPermitidas || rolesPermitidas.split(',').includes(role)) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    });
}

// ============================================================================
// 5. MÓDULO SUPER ADMIN (GESTÃO DE TENANTS)
// ============================================================================
async function carregarMasterTenants() {
    const tbody = document.getElementById('tb-master-tenants');
    if (!tbody) return;

    const { data, error } = await supabaseClient.from('tenants').select('*').order('created_at', { ascending: false });
    if (error) return;

    tbody.innerHTML = '';
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Nenhuma empresa registada.</td></tr>`;
        return;
    }

    data.forEach(t => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 hover:bg-slate-950/50";
        tr.innerHTML = `
            <td class="p-3 font-bold text-rose-300">${t.nome_fantasia}</td>
            <td class="p-3 text-slate-400">${formatarDataHora(t.created_at)}</td>
            <td class="p-3 text-right font-mono text-[10px] text-slate-500">${t.id}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleCadastrarTenantMaster(e) {
    e.preventDefault();
    const nomeEmpresa = document.getElementById('master-nome-empresa').value.trim();
    const nomeProprietario = document.getElementById('master-nome-proprietario').value.trim();
    const email = document.getElementById('master-email').value.trim();
    const password = document.getElementById('master-senha').value;

    const { data: tenantData, error: tenantError } = await supabaseClient
        .from('tenants')
        .insert([{ nome_fantasia: nomeEmpresa }])
        .select('id')
        .single();

    if (tenantError || !tenantData) {
        alert('Erro ao criar a empresa: ' + (tenantError?.message || 'Erro'));
        return;
    }

    const tenantId = tenantData.id;

    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { nome_completo: nomeProprietario } }
    });

    if (authError) {
        alert('Empresa criada, mas erro no Auth: ' + authError.message);
        return;
    }

    if (authData && authData.user) {
        await supabaseClient.from('profiles').insert([{
            id: authData.user.id,
            tenant_id: tenantId,
            nome_completo: nomeProprietario,
            perfil: 'admin',
            salario_base: 0,
            comissao_percentual: 0
        }]);
    }

    alert('Empresa criada com sucesso!');
    document.getElementById('master-nome-empresa').value = '';
    document.getElementById('master-nome-proprietario').value = '';
    document.getElementById('master-email').value = '';
    document.getElementById('master-senha').value = '';
    carregarMasterTenants();
}

// ============================================================================
// 6. MÓDULOS OPERACIONAIS E CADASTRO DE USUÁRIOS
// ============================================================================
async function inicializarModulosOperacionais() {
    await carregarCatalogo();
    await carregarKanban();
    await carregarEstadoCaixa();
    await carregarEquipe();
}

async function carregarCatalogo() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const { data } = await supabaseClient.from('catalogo').select('*').eq('tenant_id', perfilLogado.tenant_id).order('nome', { ascending: true });
    catalogoCache = data || [];
    renderizarCatalogoUI();
}

async function carregarEquipe() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const { data } = await supabaseClient.from('profiles').select('*').eq('tenant_id', perfilLogado.tenant_id);
    equipeCache = data || [];
    popularSelectsEquipe();
}

// ADMIN ATUA COMO CORINGA EM TODOS OS ESTÁGIOS DA EQUIPE
function popularSelectsEquipe() {
    const preencherSelectFiltro = (elementId, perfilDesejado) => {
        const sel = document.getElementById(elementId);
        if (!sel) return;
        sel.innerHTML = '<option value="">Selecione...</option>';
        equipeCache.filter(u => u.perfil === perfilDesejado || u.perfil === 'admin').forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.nome_completo} (${u.perfil})`;
            sel.appendChild(opt);
        });
    };

    preencherSelectFiltro('ent-lavador', 'lavador');
    preencherSelectFiltro('ent-aspirador', 'aspirador');
    preencherSelectFiltro('ent-secador', 'secador');
}

function renderizarCatalogoUI() {
    const lista = document.getElementById('lista-catalogo-cadastrado');
    if (!lista) return;
    lista.innerHTML = '';
    catalogoCache.forEach(item => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs";
        div.innerHTML = `
            <div>
                <span class="font-black text-cyan-300 block">${item.nome}</span>
                <span class="text-[10px] text-slate-400 uppercase">${item.tipo}</span>
            </div>
            <div class="flex items-center gap-4">
                <span class="font-black text-emerald-400">${formatarBRL(item.preco_venda)}</span>
                <div class="flex items-center gap-1">
                    <button onclick="prepararEdicaoCatalogo('${item.id}')" class="text-slate-400 hover:text-cyan-400 p-1.5 rounded" title="Editar Item">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="deletarItemCatalogo('${item.id}')" class="text-slate-400 hover:text-rose-400 p-1.5 rounded" title="Excluir Item">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        lista.appendChild(div);
    });
}

function prepararEdicaoCatalogo(id) {
    const item = catalogoCache.find(i => i.id === id);
    if (!item) return;
    editandoCatalogoId = item.id;
    document.getElementById('cad-tipo').value = item.tipo;
    document.getElementById('cad-nome').value = item.nome || '';
    document.getElementById('cad-custo').value = item.custo || 0;
    document.getElementById('cad-markup').value = item.markup_percentual || 0;
    document.getElementById('cad-preco').value = item.preco_venda || 0;
}

async function salvarItemCatalogo(e) {
    e.preventDefault();
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const tipo = document.getElementById('cad-tipo').value;
    const nome = document.getElementById('cad-nome').value.trim();
    const custo = parseFloat(document.getElementById('cad-custo').value) || 0;
    const markup = parseFloat(document.getElementById('cad-markup').value) || 0;
    const preco = parseFloat(document.getElementById('cad-preco').value) || 0;

    if (editandoCatalogoId) {
        await supabaseClient.from('catalogo').update({ tipo, nome, custo, markup_percentual: markup, preco_venda: preco }).eq('id', editandoCatalogoId);
        editandoCatalogoId = null;
    } else {
        await supabaseClient.from('catalogo').insert([{ tenant_id: perfilLogado.tenant_id, tipo, nome, custo, markup_percentual: markup, preco_venda: preco }]);
    }
    document.getElementById('cad-nome').value = '';
    document.getElementById('cad-custo').value = '';
    document.getElementById('cad-markup').value = '';
    document.getElementById('cad-preco').value = '';
    carregarCatalogo();
}

async function deletarItemCatalogo(id) {
    if (confirm('Excluir item?')) {
        await supabaseClient.from('catalogo').delete().eq('id', id);
        carregarCatalogo();
    }
}

function calcularPrecoPorMarkup() {
    const custo = parseFloat(document.getElementById('cad-custo').value) || 0;
    const markup = parseFloat(document.getElementById('cad-markup').value) || 0;
    if (custo > 0 && markup > 0) {
        document.getElementById('cad-preco').value = (custo + (custo * (markup / 100))).toFixed(2);
    }
}

// GESTÃO DE USUÁRIOS E EQUIPE
async function carregarUsuariosUI() {
    const lista = document.getElementById('lista-usuarios-cadastrados');
    if (!lista || !perfilLogado || !perfilLogado.tenant_id) return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('tenant_id', perfilLogado.tenant_id)
        .order('nome_completo', { ascending: true });

    if (error) return;

    lista.innerHTML = '';
    if (!data || data.length === 0) {
        lista.innerHTML = '<p class="text-xs text-slate-500 text-center py-3">Nenhum usuário cadastrado.</p>';
        return;
    }

    data.forEach(u => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs";
        div.innerHTML = `
            <div>
                <span class="font-black text-slate-200 uppercase block">${u.nome_completo || 'Sem Nome'}</span>
                <span class="text-[10px] text-cyan-400 font-bold uppercase">${u.perfil} | Salário: ${formatarBRL(u.salario_base)} | Comissão: ${u.comissao_percentual || 0}%</span>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="prepararEdicaoUsuario('${u.id}')" class="text-slate-400 hover:text-cyan-400 p-1.5 rounded" title="Editar Usuário">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deletarUsuario('${u.id}')" class="text-slate-400 hover:text-rose-400 p-1.5 rounded" title="Excluir">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        lista.appendChild(div);
    });
}

function prepararEdicaoUsuario(id) {
    const usuario = equipeCache.find(u => u.id === id);
    if (!usuario) return;

    editandoUsuarioId = usuario.id;
    document.getElementById('usr-id-edit').value = usuario.id;
    document.getElementById('usr-nome').value = usuario.nome_completo || '';
    document.getElementById('usr-perfil').value = usuario.perfil || 'lavador';
    document.getElementById('usr-salario').value = usuario.salario_base || 0;
    document.getElementById('usr-comissao').value = usuario.comissao_percentual || 0;

    document.getElementById('form-usr-titulo').innerHTML = `<i class="fa-solid fa-users-gear"></i> Editar Usuário: ${usuario.nome_completo}`;
    document.getElementById('btn-cancelar-edit-usr').classList.remove('hidden');
    document.getElementById('btn-salvar-usr').innerText = 'Atualizar Usuário';
}

function cancelarEdicaoUsuario() {
    editandoUsuarioId = null;
    document.getElementById('usr-id-edit').value = '';
    document.getElementById('usr-nome').value = '';
    document.getElementById('usr-salario').value = '';
    document.getElementById('usr-comissao').value = '';

    document.getElementById('form-usr-titulo').innerHTML = `<i class="fa-solid fa-users-gear"></i> Cadastrar / Editar Funcionário ou Usuário`;
    document.getElementById('btn-cancelar-edit-usr').classList.add('hidden');
    document.getElementById('btn-salvar-usr').innerText = 'Salvar Usuário';
}

async function salvarUsuario(e) {
    e.preventDefault();
    if (!perfilLogado || !perfilLogado.tenant_id) {
        alert('Erro: Sessão sem tenant identificado.');
        return;
    }

    const nome = document.getElementById('usr-nome').value.trim();
    const perfil = document.getElementById('usr-perfil').value;
    const salario = parseFloat(document.getElementById('usr-salario').value) || 0;
    const comissao = parseFloat(document.getElementById('usr-comissao').value) || 0;

    if (!nome) {
        alert('Preencha o nome do usuário.');
        return;
    }

    let error;
    if (editandoUsuarioId) {
        const res = await supabaseClient
            .from('profiles')
            .update({
                nome_completo: nome,
                perfil: perfil,
                salario_base: salario,
                comissao_percentual: comissao
            })
            .eq('id', editandoUsuarioId);
        error = res.error;
        editandoUsuarioId = null;
    } else {
        const novoId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });

        const res = await supabaseClient
            .from('profiles')
            .insert([{
                id: novoId,
                tenant_id: perfilLogado.tenant_id,
                nome_completo: nome,
                perfil: perfil,
                salario_base: salario,
                comissao_percentual: comissao
            }]);
        error = res.error;
    }

    if (error) {
        alert('Erro ao salvar o usuário: ' + error.message);
        return;
    }

    alert('Funcionário/Usuário salvo com sucesso!');
    cancelarEdicaoUsuario();
    await carregarEquipe();
    carregarUsuariosUI();
}

async function deletarUsuario(id) {
    if (confirm('Deseja excluir este usuário?')) {
        await supabaseClient.from('profiles').delete().eq('id', id);
        await carregarEquipe();
        carregarUsuariosUI();
    }
}

// SELEÇÃO DINÂMICA DE ITENS NA NOVA ENTRADA
function abrirModalCatalogoEntrada(tipoFiltro) {
    const modal = document.getElementById('modal-selecionar-item-entrada');
    const container = document.getElementById('modal-lista-catalogo');
    const titulo = document.getElementById('modal-tipo-titulo');
    titulo.innerText = `Selecionar ${tipoFiltro === 'servico' ? 'Serviço' : 'Produto'}`;
    container.innerHTML = '';
    const filtrados = catalogoCache.filter(i => i.tipo === tipoFiltro);
    if (filtrados.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Nenhum ${tipoFiltro} cadastrado.</p>`;
    } else {
        filtrados.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = "w-full text-left bg-slate-950 hover:bg-slate-800 p-3 rounded-xl border border-slate-800 flex justify-between items-center transition-all";
            btn.innerHTML = `<span class="font-bold text-slate-200 text-xs">${item.nome}</span><span class="font-black text-emerald-400 text-xs">${formatarBRL(item.preco_venda)}</span>`;
            btn.onclick = () => adicionarItemNovaEntrada(item);
            container.appendChild(btn);
        });
    }
    modal.classList.remove('hidden');
}

function fecharModalCatalogoEntrada() { document.getElementById('modal-selecionar-item-entrada').classList.add('hidden'); }
function adicionarItemNovaEntrada(item) { itensNovaEntradaSelecionados.push(item); renderizarPreviewItensEntrada(); fecharModalCatalogoEntrada(); }
function removerItemNovaEntrada(index) { itensNovaEntradaSelecionados.splice(index, 1); renderizarPreviewItensEntrada(); }

function renderizarPreviewItensEntrada() {
    const container = document.getElementById('lista-itens-entrada-preview');
    container.innerHTML = '';
    if (itensNovaEntradaSelecionados.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 text-center py-3" id="msg-sem-itens">Nenhum serviço ou produto adicionado ainda.</p>`;
        document.getElementById('ent-total-display').innerText = formatarBRL(0);
        return;
    }
    let total = 0;
    itensNovaEntradaSelecionados.forEach((item, idx) => {
        total += parseFloat(item.preco_venda) || 0;
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-xs";
        div.innerHTML = `<div><span class="font-bold text-cyan-300">${item.nome}</span></div><div class="flex items-center gap-3"><span class="font-black text-emerald-400">${formatarBRL(item.preco_venda)}</span><button type="button" onclick="removerItemNovaEntrada(${idx})" class="text-rose-400"><i class="fa-solid fa-trash"></i></button></div>`;
        container.appendChild(div);
    });
    document.getElementById('ent-total-display').innerText = formatarBRL(total);
}

async function salvarNovaEntrada(e) {
    e.preventDefault();
    if (!perfilLogado) return;
    const placa = document.getElementById('ent-placa').value.trim().toUpperCase();
    const modelo = document.getElementById('ent-modelo').value.trim();
    const clienteNome = document.getElementById('ent-cliente').value.trim();
    const lavadorId = document.getElementById('ent-lavador').value || null;
    const aspiradorId = document.getElementById('ent-aspirador').value || null;
    const secadorId = document.getElementById('ent-secador').value || null;
    const obs = document.getElementById('ent-obs').value.trim();

    if (itensNovaEntradaSelecionados.length === 0) { alert('Adicione pelo menos um item.'); return; }
    let valorTotal = 0;
    itensNovaEntradaSelecionados.forEach(i => valorTotal += parseFloat(i.preco_venda) || 0);

    let clienteId = null;
    const { data: cliExistente } = await supabaseClient.from('clientes').select('id').eq('tenant_id', perfilLogado.tenant_id).eq('telefone', clienteNome).maybeSingle();
    if (cliExistente) { clienteId = cliExistente.id; }
    else {
        const { data: novoCli } = await supabaseClient.from('clientes').insert([{ tenant_id: perfilLogado.tenant_id, nome: clienteNome, telefone: clienteNome }]).select('id').single();
        if (novoCli) clienteId = novoCli.id;
    }

    const descricaoItens = itensNovaEntradaSelecionados.map(i => i.nome).join(', ');
    await supabaseClient.from('ordens_servico').insert([{
        tenant_id: perfilLogado.tenant_id,
        placa, modelo, cliente_id: clienteId,
        lavador_id: lavadorId, aspirador_id: aspiradorId, secador_id: secadorId,
        valor_total: valorTotal,
        observacoes: `${obs} | Itens: ${descricaoItens}`,
        status: 'fila'
    }]);

    alert('Veículo inserido na Fila!');
    document.getElementById('form-nova-entrada').reset();
    itensNovaEntradaSelecionados = [];
    renderizarPreviewItensEntrada();
    navegarPara('acompanhamento');
}

// KANBAN
async function carregarKanban() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const { data } = await supabaseClient.from('ordens_servico').select(`id, placa, modelo, cliente_id, valor_total, status, observacoes, created_at, clientes ( nome, telefone ), lavador:profiles!lavador_id ( nome_completo ), aspirador:profiles!aspirador_id ( nome_completo )`).eq('tenant_id', perfilLogado.tenant_id).is('data_pagamento', null).order('created_at', { ascending: false });
    ordensPendenteCache = data || [];
    renderizarKanbanUI();
}

function renderizarKanbanUI() {
    const colFila = document.getElementById('col-fila');
    const colLavagem = document.getElementById('col-lavagem');
    const colPronto = document.getElementById('col-pronto');
    const colEntregue = document.getElementById('col-entregue');
    if (!colFila) return;
    colFila.innerHTML = ''; colLavagem.innerHTML = ''; colPronto.innerHTML = ''; colEntregue.innerHTML = '';
    let cFila = 0, cLav = 0, cPro = 0, cEnt = 0;

    ordensPendenteCache.forEach(o => {
        const card = document.createElement('div');
        card.className = "bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2.5 shadow-md relative group hover:border-cyan-500/50 transition-all";
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div><span class="text-lg font-black text-cyan-300">${o.placa}</span><span class="text-xs block text-slate-300">${o.modelo || ''}</span></div>
                <div class="text-right"><span class="text-xs font-black text-emerald-400 bg-emerald-950 px-2 py-1 rounded block">${formatarBRL(o.valor_total)}</span><button onclick="abrirModalKanbanAdicionarItem('${o.id}')" class="text-[10px] text-amber-400 mt-1 block font-bold">+ Add Item</button></div>
            </div>
            <div class="text-[11px] text-slate-400"><p>${o.clientes?.nome || 'Sem Cadastro'}</p></div>
            <div class="pt-2 border-t border-slate-800 flex justify-between items-center">
                ${o.status !== 'fila' ? `<button onclick="atualizarStatusOrdem('${o.id}', -1, '${o.status}')" class="text-[10px] bg-slate-900 border border-slate-700 text-slate-300 px-2 py-1 rounded">Voltar</button>` : '<span></span>'}
                <button onclick="atualizarStatusOrdem('${o.id}', 1, '${o.status}')" class="text-[10px] bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold px-2.5 py-1 rounded">Avançar</button>
            </div>
        `;
        if (o.status === 'fila') { colFila.appendChild(card); cFila++; }
        else if (o.status === 'execucao') { colLavagem.appendChild(card); cLav++; }
        else if (o.status === 'pronto') { colPronto.appendChild(card); cPro++; }
        else if (o.status === 'entregue') { colEntregue.appendChild(card); cEnt++; }
    });
    document.getElementById('badge-count-fila').innerText = cFila;
    document.getElementById('badge-count-lavagem').innerText = cLav;
    document.getElementById('badge-count-pronto').innerText = cPro;
    document.getElementById('badge-count-entregue').innerText = cEnt;
    document.getElementById('count-patio').innerText = `${cFila + cLav + cPro} carros`;
}

function abrirModalKanbanAdicionarItem(ordemId) {
    document.getElementById('kanban-item-ordem-id').value = ordemId;
    const select = document.getElementById('kanban-select-item');
    select.innerHTML = '';
    catalogoCache.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = `${i.nome} - ${formatarBRL(i.preco_venda)}`;
        select.appendChild(opt);
    });
    document.getElementById('modal-kanban-adicionar-item').classList.remove('hidden');
}

function fecharModalKanbanAdicionarItem() { document.getElementById('modal-kanban-adicionar-item').classList.add('hidden'); }

async function confirmarAdicionarItemKanban() {
    const ordemId = document.getElementById('kanban-item-ordem-id').value;
    const itemId = document.getElementById('kanban-select-item').value;
    const itemCatalogo = catalogoCache.find(i => i.id === itemId);
    const ordem = ordensPendenteCache.find(o => o.id === ordemId);
    if (!itemCatalogo || !ordem) return;

    const novoTotal = (parseFloat(ordem.valor_total) || 0) + (parseFloat(itemCatalogo.preco_venda) || 0);
    await supabaseClient.from('ordens_servico').update({ valor_total: novoTotal, observacoes: `${ordem.observacoes || ''} | Adicionado: ${itemCatalogo.nome}` }).eq('id', ordemId);
    fecharModalKanbanAdicionarItem();
    carregarKanban();
}

async function atualizarStatusOrdem(ordemId, direcao, statusAtual) {
    const sequencia = ['fila', 'execucao', 'pronto', 'entregue'];
    let idxAtual = sequencia.indexOf(statusAtual);
    let novoIdx = idxAtual + direcao;
    if (novoIdx >= 0 && novoIdx < sequencia.length) {
        await supabaseClient.from('ordens_servico').update({ status: sequencia[novoIdx] }).eq('id', ordemId);
        carregarKanban();
    }
}

// CAIXA E ABERTURA DE SESSÃO
async function carregarEstadoCaixa() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const { data } = await supabaseClient.from('caixa_sessoes').select('*').eq('tenant_id', perfilLogado.tenant_id).is('data_fechamento', null).maybeSingle();
    caixaAtual = data || null;
    atualizarUIEstadoCaixa();
    carregarComandasCaixa();
}

function atualizarUIEstadoCaixa() {
    const pill = document.getElementById('cx-status-pill');
    const headerPill = document.getElementById('badge-status-caixa-header');
    const headerLabel = document.getElementById('label-caixa-status-header');
    const btnAbrir = document.getElementById('btn-abrir-caixa');
    const btnSangria = document.getElementById('btn-sangria-caixa');
    const btnFechar = document.getElementById('btn-fechar-caixa');

    if (caixaAtual) {
        if (pill) { pill.className = "text-xs font-black px-3 py-1 rounded-full uppercase bg-emerald-950 text-emerald-400 border border-emerald-800"; pill.innerText = "ABERTO"; }
        if (headerPill) { headerPill.className = "flex items-center gap-2 bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 px-3 py-1 rounded-full text-xs font-bold"; }
        if (headerLabel) { headerLabel.innerText = "CAIXA ABERTO"; }
        if (btnAbrir) btnAbrir.classList.add('hidden');
        if (btnSangria) btnSangria.classList.remove('hidden');
        if (btnFechar) btnFechar.classList.remove('hidden');
    } else {
        if (pill) { pill.className = "text-xs font-black px-3 py-1 rounded-full uppercase bg-rose-950 text-rose-400 border border-rose-800"; pill.innerText = "FECHADO"; }
        if (headerPill) { headerPill.className = "flex items-center gap-2 bg-rose-950/80 border border-rose-800/80 text-rose-300 px-3 py-1 rounded-full text-xs font-bold"; }
        if (headerLabel) { headerLabel.innerText = "CAIXA FECHADO"; }
        if (btnAbrir) btnAbrir.classList.remove('hidden');
        if (btnSangria) btnSangria.classList.add('hidden');
        if (btnFechar) btnFechar.classList.add('hidden');
    }
}

async function abrirModalAbrirCaixa() {
    const valorTroco = prompt('Informe o valor do troco inicial / fundo de caixa (R$):', '100.00');
    if (valorTroco === null) return;
    const fundo = parseFloat(valorTroco) || 0;

    if (!perfilLogado || !perfilLogado.tenant_id) return;

    const { data, error } = await supabaseClient.from('caixa_sessoes').insert([{
        tenant_id: perfilLogado.tenant_id,
        aberto_por: perfilLogado.id,
        fundo_troco: fundo,
        data_abertura: new Date().toISOString()
    }]).select('*').single();

    if (error) {
        alert('Erro ao abrir o caixa: ' + error.message);
        return;
    }

    alert('Caixa aberto com sucesso!');
    caixaAtual = data;
    atualizarUIEstadoCaixa();
    carregarComandasCaixa();
}

async function carregarComandasCaixa() {
    const tbody = document.getElementById('tb-caixa-body');
    if (!tbody || !perfilLogado || !perfilLogado.tenant_id) return;

    // Traz comandas do dia ou pendentes para exibir no caixa (incluindo as já recebidas para aparecerem quitadas)
    const { data } = await supabaseClient.from('ordens_servico').select(`id, placa, modelo, valor_total, status, data_pagamento, forma_pagamento, clientes ( nome )`).eq('tenant_id', perfilLogado.tenant_id).order('created_at', { ascending: false }).limit(50);
    
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Nenhuma comanda registada.</td></tr>`;
        return;
    }

    data.forEach(o => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 hover:bg-slate-950/50 text-xs";
        
        let acaoHtml = '';
        if (o.data_pagamento) {
            acaoHtml = `<span class="bg-emerald-950 text-emerald-400 font-bold px-2 py-1 rounded border border-emerald-800">QUITADO (${o.forma_pagamento || '-'})</span>`;
        } else {
            acaoHtml = `<button onclick="abrirModalRecebimento('${o.id}', ${o.valor_total}, '${o.placa}')" class="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black px-3 py-1.5 rounded-lg">Receber</button>`;
        }

        tr.innerHTML = `
            <td class="p-3.5 font-bold text-cyan-300">${o.placa} <span class="text-[10px] text-slate-400 block">${o.modelo || ''}</span></td>
            <td class="p-3.5 text-slate-300">${o.clientes?.nome || 'Cliente Balcão'}</td>
            <td class="p-3.5 font-black text-emerald-400">${formatarBRL(o.valor_total)}</td>
            <td class="p-3.5 text-right">${acaoHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

// MODAL / FLUXO DE RECEBIMENTO COM FORMAS DE PAGAMENTO E PRAZO DE CARTEIRA
let ordemRecebimentoAtualId = null;
function abrirModalRecebimento(ordemId, valor, placa) {
    if (!caixaAtual) {
        alert('O caixa precisa estar aberto para receber pagamentos!');
        return;
    }
    ordemRecebimentoAtualId = ordemId;
    let modal = document.getElementById('modal-recebimento-custom');
    if (!modal) {
        // Criar modal dinamicamente caso não exista no HTML
        const div = document.createElement('div');
        div.id = 'modal-recebimento-custom';
        div.className = "fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4";
        div.innerHTML = `
            <div class="bg-slate-900 border border-slate-800 w-full max-w-md p-6 rounded-2xl space-y-4 shadow-2xl">
                <h3 class="text-base font-black text-white flex items-center gap-2"><i class="fa-solid fa-cash-register text-emerald-400"></i> Recebimento da Comanda (${placa})</h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs text-slate-400 block mb-1">Forma de Pagamento</label>
                        <select id="rec-forma" onchange="toggleCampoCarteira()" class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200">
                            <option value="dinheiro">Dinheiro</option>
                            <option value="pix">Pix</option>
                            <option value="cartao_credito">Cartão de Crédito</option>
                            <option value="cartao_debito">Cartão de Débito</option>
                            <option value="carteira">Carteira (Fiado / A Prazo)</option>
                        </select>
                    </div>
                    <div id="div-dias-carteira" class="hidden">
                        <label class="text-xs text-amber-400 block mb-1 font-bold">Prazo para Pagamento (Dias)</label>
                        <input type="number" id="rec-dias" value="3" min="1" class="w-full bg-slate-950 border border-amber-800/60 rounded-xl p-3 text-sm text-white font-bold" placeholder="Ex: 5, 10, 15 dias">
                    </div>
                </div>
                <div class="flex justify-end gap-3 pt-4 border-t border-slate-800">
                    <button type="button" onclick="fecharModalRecebimento()" class="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold">Cancelar</button>
                    <button type="button" onclick="confirmarRecebimentoComanda()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-xl text-xs font-black">Confirmar Recebimento</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    } else {
        modal.classList.remove('hidden');
    }
    document.getElementById('rec-forma').value = 'dinheiro';
    toggleCampoCarteira();
}

function fecharModalRecebimento() {
    const modal = document.getElementById('modal-recebimento-custom');
    if (modal) modal.classList.add('hidden');
}

function toggleCampoCarteira() {
    const forma = document.getElementById('rec-forma').value;
    const divDias = document.getElementById('div-dias-carteira');
    if (forma === 'carteira') {
        divDias.classList.remove('hidden');
    } else {
        divDias.classList.add('hidden');
    }
}

async function confirmarRecebimentoComanda() {
    if (!ordemRecebimentoAtualId || !caixaAtual) return;
    const forma = document.getElementById('rec-forma').value;
    let dias = 0;
    let dataVenc = null;

    if (forma === 'carteira') {
        dias = parseInt(document.getElementById('rec-dias').value) || 3;
        const d = new Date();
        d.setDate(d.getDate() + dias);
        dataVenc = d.toISOString();
    }

    const { error } = await supabaseClient.from('ordens_servico').update({
        status: 'entregue',
        data_pagamento: new Date().toISOString(),
        forma_pagamento: forma,
        dias_carteira: dias,
        data_vencimento_carteira: dataVenc,
        caixa_sessao_id: caixaAtual.id
    }).eq('id', ordemRecebimentoAtualId);

    if (error) {
        alert('Erro ao registar pagamento: ' + error.message);
        return;
    }

    alert('Pagamento registado com sucesso! A comanda foi encerrada e contabilizada.');
    fecharModalRecebimento();
    carregarComandasCaixa();
    carregarKanban();
}

// ============================================================================
// 7. HISTÓRICO DE PASSAGENS DE ATENDIMENTO
// ============================================================================
async function carregarHistoricoPassagens() {
    const tbody = document.getElementById('tb-historico-body');
    const filtroPlaca = document.getElementById('hist-busca-placa')?.value?.trim().toUpperCase() || '';
    if (!tbody || !perfilLogado || !perfilLogado.tenant_id) return;

    let query = supabaseClient.from('ordens_servico').select(`id, placa, modelo, valor_total, data_pagamento, forma_pagamento, observacoes, created_at, clientes ( nome )`).eq('tenant_id', perfilLogado.tenant_id).order('created_at', { ascending: false });

    if (filtroPlaca) {
        query = query.ilike('placa', `%${filtroPlaca}%`);
    }

    const { data } = await query.limit(50);
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Nenhum histórico encontrado.</td></tr>`;
        return;
    }

    data.forEach(o => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 hover:bg-slate-950/50 text-xs";
        tr.innerHTML = `
            <td class="p-3.5 font-bold text-cyan-300">${o.placa} <span class="text-[10px] text-slate-400 block">${o.modelo || ''}</span></td>
            <td class="p-3.5 text-slate-300">${o.clientes?.nome || 'Cliente Balcão'}</td>
            <td class="p-3.5">${formatarDataHora(o.created_at)}</td>
            <td class="p-3.5 font-black text-emerald-400">${formatarBRL(o.valor_total)} <span class="block text-[10px] text-slate-400 font-normal">${o.forma_pagamento ? o.forma_pagamento.toUpperCase() : 'Pendente'}</span></td>
            <td class="p-3.5 text-slate-400">${o.observacoes || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ============================================================================
// 8. MÓDULO FINANCEIRO (RECEITA, FOLHA, VALES E CARTEIRA PENDENTE)
// ============================================================================
async function carregarModuloFinanceiro() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;

    // 1. Recebidos no caixa atual ou geral
    const { data: ordensRecebidas } = await supabaseClient.from('ordens_servico').select('valor_total, forma_pagamento').eq('tenant_id', perfilLogado.tenant_id).not('data_pagamento', 'is', null);
    
    let totalRecebido = 0;
    if (ordensRecebidas) {
        ordensRecebidas.forEach(o => totalRecebido += parseFloat(o.valor_total) || 0);
    }
    const elRec = document.getElementById('fin-total-recebido');
    if (elRec) elRec.innerText = formatarBRL(totalRecebido);

    // 2. Pendentes em Carteira
    const { data: ordensCarteira } = await supabaseClient.from('ordens_servico').select(`id, placa, valor_total, data_vencimento_carteira, observacoes, clientes ( nome )`).eq('tenant_id', perfilLogado.tenant_id).eq('forma_pagamento', 'carteira').is('data_pagamento', null);
    
    const tbodyCarteira = document.getElementById('tb-carteira-pendente');
    if (tbodyCarteira) {
        tbodyCarteira.innerHTML = '';
        let totalCarteira = 0;
        if (!ordensCarteira || ordensCarteira.length === 0) {
            tbodyCarteira.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Nenhum recebimento pendente em carteira.</td></tr>`;
        } else {
            ordensCarteira.forEach(o => {
                totalCarteira += parseFloat(o.valor_total) || 0;
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-800 text-xs";
                tr.innerHTML = `
                    <td class="p-3 font-bold text-amber-300">${o.clientes?.nome || 'Cliente'}</td>
                    <td class="p-3 font-mono text-cyan-300">${o.placa}</td>
                    <td class="p-3 text-slate-300">${o.observacoes || 'Serviço de Lavagem'}</td>
                    <td class="p-3 font-black text-emerald-400">${formatarBRL(o.valor_total)}</td>
                    <td class="p-3 text-slate-300">${formatarDataHora(o.data_vencimento_carteira)}</td>
                `;
                tbodyCarteira.appendChild(tr);
            });
        }
        const elCart = document.getElementById('fin-total-carteira');
        if (elCart) elCart.innerText = formatarBRL(totalCarteira);
    }

    // 3. Folha de Pagamento e Vales da Equipe
    carregarFolhaPagamentoUI();
}

async function carregarFolhaPagamentoUI() {
    const tbody = document.getElementById('tb-folha-pagamento');
    if (!tbody || !perfilLogado || !perfilLogado.tenant_id) return;

    const { data: funcionarios } = await supabaseClient.from('profiles').select('*').eq('tenant_id', perfilLogado.tenant_id);
    tbody.innerHTML = '';

    if (!funcionarios || funcionarios.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Nenhum funcionário registado.</td></tr>`;
        return;
    }

    funcionarios.forEach(f => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-800 text-xs";
        tr.innerHTML = `
            <td class="p-3 font-bold text-slate-200">${f.nome_completo} <span class="text-[10px] text-cyan-400 block uppercase">${f.perfil}</span></td>
            <td class="p-3 text-emerald-400 font-bold">${formatarBRL(f.salario_base)}</td>
            <td class="p-3 text-amber-400">R$ 0,00</td>
            <td class="p-3 text-right"><button onclick="registarValeFuncionario('${f.id}', '${f.nome_completo}')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-2.5 py-1 rounded">Registar Vale / Adiantamento</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function registarValeFuncionario(profileId, nome) {
    const valor = prompt(`Informe o valor do adiantamento / vale para ${nome} (R$):`, '50.00');
    if (valor === null) return;
    const valNum = parseFloat(valor) || 0;
    const obs = prompt('Motivo / Observação do vale:', 'Adiantamento quinzenal');

    await supabaseClient.from('vales_adiantamentos').insert([{
        tenant_id: perfilLogado.tenant_id,
        profile_id: profileId,
        tipo: 'vale',
        valor: valNum,
        observacao: obs
    }]);

    alert('Vale registado com sucesso!');
    carregarFolhaPagamentoUI();
}

// FECHAMENTO DE CAIXA COM RELATÓRIO E SANGRIA
async function abrirModalFecharCaixa() {
    if (!caixaAtual) {
        alert('Não existe nenhum caixa aberto no momento!');
        return;
    }

    const valorContado = prompt('Informe o valor total em dinheiro contado no gaveteiro para fechamento (R$):', '0.00');
    if (valorContado === null) return;
    const dinheiroContado = parseFloat(valorContado) || 0;

    // Buscar recebimentos da sessão atual
    const { data: ordensSessao } = await supabaseClient.from('ordens_servico').select('valor_total, forma_pagamento').eq('caixa_sessao_id', caixaAtual.id);
    
    let totalDinheiro = 0, totalPix = 0, totalCredito = 0, totalDebito = 0, totalCarteira = 0;
    if (ordensSessao) {
        ordensSessao.forEach(o => {
            const v = parseFloat(o.valor_total) || 0;
            if (o.forma_pagamento === 'dinheiro') totalDinheiro += v;
            else if (o.forma_pagamento === 'pix') totalPix += v;
            else if (o.forma_pagamento === 'cartao_credito') totalCredito += v;
            else if (o.forma_pagamento === 'cartao_debito') totalDebito += v;
            else if (o.forma_pagamento === 'carteira') totalCarteira += v;
        });
    }

    const fundoTroco = parseFloat(caixaAtual.fundo_troco) || 0;
    const totalGeralRecebido = totalDinheiro + totalPix + totalCredito + totalDebito;

    // Fechar sessão no banco
    await supabaseClient.from('caixa_sessoes').update({
        data_fechamento: new Date().toISOString(),
        valor_fechamento: dinheiroContado
    }).eq('id', caixaAtual.id);

    // Gerar resumo para impressão/alerta
    const relatorioTexto = `=== RESUMO DIÁRIO DE CAIXA ===
Data/Hora Fechamento: ${formatarDataHora(new Date())}
Fundo de Troco Inicial: ${formatarBRL(fundoTroco)}

RECEBIMENTOS DO DIA:
- Dinheiro: ${formatarBRL(totalDinheiro)}
- Pix: ${formatarBRL(totalPix)}
- Cartão Crédito: ${formatarBRL(totalCredito)}
- Cartão Débito: ${formatarBRL(totalDebito)}
- Carteira (Pendente): ${formatarBRL(totalCarteira)}

TOTAL GERAL RECEBIDO: ${formatarBRL(totalGeralRecebido)}
Dinheiro Contado no Gaveteiro: ${formatarBRL(dinheiroContado)}
=============================`;

    alert(relatorioTexto);
    caixaAtual = null;
    atualizarUIEstadoCaixa();
    window.location.reload();
}

async function abrirModalSangria() {
    if (!caixaAtual) {
        alert('Abra o caixa antes de efetuar sangrias.');
        return;
    }
    const valorSangria = prompt('Informe o valor da sangria (retirada de dinheiro do caixa):', '50.00');
    if (valorSangria === null) return;
    const motivo = prompt('Motivo da sangria:', 'Pagamento de despesa rápida');

    alert(`Sangria de ${formatarBRL(valorSangria)} registada com sucesso! Motivo: ${motivo}`);
}

async function carregarModuloRelatorios() {}
function fecharModalAbrirCaixa() {}
function fecharModalFecharCaixa() { window.location.reload(); }

window.addEventListener('DOMContentLoaded', async () => {
    if (!supabaseClient) alert('Erro ao conectar com Supabase.');
});