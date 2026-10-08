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
let comandaPagandoId = null;
let comandaPagandoValor = 0;
let metodoPagamentoSelecionado = 'dinheiro';

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
    if (telaId === 'relatorios') carregarModuloRelatorios();
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

function popularSelectsEquipe() {
    ['ent-lavador', 'ent-aspirador', 'ent-secador', 'adv-usuario'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">Selecione...</option>';
        equipeCache.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.nome_completo} (${u.perfil})`;
            sel.appendChild(opt);
        });
    });
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

    document.getElementById('form-usr-titulo').innerHTML = `<i class="fa-solid fa-users-gear"></i> Cadastrar / Editar Usuário`;
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

// CAIXA E RELATÓRIOS
async function carregarEstadoCaixa() {
    if (!perfilLogado || !perfilLogado.tenant_id) return;
    const { data } = await supabaseClient.from('caixa_sessoes').select('*').eq('tenant_id', perfilLogado.tenant_id).is('data_fechamento', null).maybeSingle();
    caixaAtual = data || null;
    atualizarUIEstadoCaixa();
    carregarComandasCaixa();
}
function atualizarUIEstadoCaixa() {}
async function carregarComandasCaixa() {}
async function carregarModuloRelatorios() {}
async function carregarHistoricoPassagens() {}
async function abrirModalAbrirCaixa() {}
function fecharModalAbrirCaixa() {}
function confirmarAberturaCaixa(e) { e.preventDefault(); }
function abrirModalSangria() {}
function fecharModalSangria() {}
function confirmarSangriaCaixa(e) { e.preventDefault(); }
function abrirModalFecharCaixa() {}
function fecharModalFecharCaixa() { window.location.reload(); }
function calcularDiferencaFechamento() {}
function confirmarFechamentoCaixa(e) { e.preventDefault(); }
function abrirModalPagamento() {}
function fecharModalPagamento() {}
function selecionarFormaPagamento() {}
function confirmarBaixaCaixa() {}
function abrirModalAdiantamento() {}
function fecharModalAdiantamento() {}
function salvarAdiantamento(e) { e.preventDefault(); }
function quitarFiado() {}

window.addEventListener('DOMContentLoaded', async () => {
    if (!supabaseClient) alert('Erro ao conectar com Supabase.');
});