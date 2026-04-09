// ============================================================================
// [01] CONFIGURAÇÕES INICIAIS E VARIÁVEIS GLOBAIS
// ============================================================================
// AQUI ESTÁ A LIGAÇÃO COM A INTERNET (RENDER)
const socket = io('https://imaqueiro.onrender.com'); 

let usuario, pedidosAtivos = [], historicoGlobal = [], idChamadoAtual, idChatAtivo, html5QrCode;
let chamadosRejeitados = []; let idChecklistAtual = null; let graficoSetoresInstancia = null; let qrcodeGerado = null;
let audioLigado = false;
let timerDespacho; 
let tempoRestanteDespacho = 15;
let filtroAtivoADM = 'todos'; 
let idChamadoParaCancelar = null;
let alertasMostrados = new Set();
let modoPedidoAtual = 'imediato';

// ============================================================================
// [02] INICIALIZAÇÃO, SERVICE WORKERS E TEMA
// ============================================================================
window.onload = () => { 
    try { 
        const salvo = localStorage.getItem('imaqueiro_user'); 
        if (salvo) { 
            usuario = JSON.parse(salvo); 
            socket.emit('relogar_maqueiro', usuario); 
            abrirPainel(usuario); 
        } 
    } catch(e) { 
        console.error("Erro ao carregar usuário salvo", e); 
        localStorage.removeItem('imaqueiro_user'); 
    }
};

if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js') }); }
window.addEventListener('offline', () => { document.getElementById('offline-banner').style.display = 'block'; });
window.addEventListener('online', () => { document.getElementById('offline-banner').style.display = 'none'; });

function applyTheme(theme) {
    try {
        document.documentElement.setAttribute('data-theme', theme);
        const icons = ['theme-icon-coord', 'theme-icon-nurse', 'theme-icon-maq'];
        icons.forEach(id => {
            const el = document.getElementById(id);
            if(el) { el.className = theme === 'dark' ? 'fa fa-sun modern-icon' : 'fa fa-moon modern-icon'; el.style.color = theme === 'dark' ? '#F59E0B' : 'inherit'; }
        });
        if (graficoSetoresInstancia) graficoSetoresInstancia.update();
    } catch(e) { console.error("Erro no tema", e); }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('imaqueiro_theme', newTheme);
    applyTheme(newTheme);
}

const savedTheme = localStorage.getItem('imaqueiro_theme') || 'light';
applyTheme(savedTheme);

// ============================================================================
// [03] AUTENTICAÇÃO (LOGIN, LOGOUT E NOTIFICAÇÕES BACKGROUND)
// ============================================================================
function tentarLogin() { 
    try { 
        if(document.activeElement) document.activeElement.blur(); 
        ativarAudio(); 
        const email = document.getElementById('login-email').value; 
        const senha = document.getElementById('login-senha').value; 
        if(email && senha) { 
            socket.emit('fazer_login', { email: email, senha: senha }); 
        } else { 
            document.getElementById('login-msg').innerHTML = `<i class="fa fa-exclamation-triangle modern-icon"></i> Preencha os dados!`; 
        } 
    } catch (e) { console.error("Erro no login", e); }
}

socket.on('login_sucesso', u => { 
    usuario = u; 
    localStorage.setItem('imaqueiro_user', JSON.stringify(u)); 
    document.getElementById('login-animation').style.display = 'flex'; 
    
    // Inicia a "Escuta" das notificações no celular logo após o login!
    inicializarNotificacoesNativas();
    
    setTimeout(() => { document.getElementById('login-animation').style.display = 'none'; abrirPainel(u); }, 1000); 
});

socket.on('login_erro', m => { document.getElementById('login-msg').innerHTML = `<i class="fa fa-exclamation-triangle modern-icon"></i> ${m}`; });
function fazerLogout() { localStorage.removeItem('imaqueiro_user'); location.reload(); }

// ============================================================================
// [04] MOTOR DE NOTIFICAÇÕES (PUSH NOTIFICATIONS CAPACITOR) - OPÇÃO A (ALARME)
// ============================================================================
async function inicializarNotificacoesNativas() {
    try {
        // LINHA 1: Verifica se o aplicativo está rodando dentro do celular (Capacitor) e se o motor de notificação existe.
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) {
            
            // LINHA 2: Cria um "atalho" para o motor de notificações, para não ter que digitar esse nome gigante toda hora.
            const PushNotifications = window.Capacitor.Plugins.PushNotifications;
            
            // LINHA 3: Pula aquela janelinha na tela do Android perguntando: "Permitir que este app envie notificações?"
            let permStatus = await PushNotifications.requestPermissions();
            
            // LINHA 4: Se o maqueiro clicou em "Permitir" ('granted')...
            if (permStatus.receive === 'granted') { 
                // LINHA 5: Inscreve o celular na nuvem do Google (FCM) para ele poder receber mensagens.
                PushNotifications.register(); 
            }

            // ==========================================
            // CRIANDO OS CANAIS DE SOM NATIVO DO ANDROID
            // ==========================================
            
            // LINHA 6: Avisa ao Android para criar um "Canal" de avisos normais (Prioridade Amarela/Verde).
            PushNotifications.createChannel({
                id: 'canal_rotina',           // Nome interno que o nosso servidor (Render) vai chamar.
                name: 'Chamados Normais',     // O nome que o maqueiro vê nas configurações do Android.
                importance: 5,                // Nível 5 (Máximo): Força o Android a fazer barulho e mostrar na tela.
                visibility: 1,                // Nível 1: Permite que a mensagem apareça mesmo com a tela bloqueada por senha.
                sound: 'alerta',              // Manda o Android procurar o arquivo "alerta.mp3" na pasta "raw".
                vibration: true               // Liga o motor de vibração do celular.
            });

            // LINHA 7: Avisa ao Android para criar o Canal Escandaloso (Prioridade Vermelha / SOS).
            PushNotifications.createChannel({
                id: 'canal_emergencia',       // Nome interno do canal de emergência.
                name: 'Código Azul',          // Nome visível nas configurações.
                importance: 5,                // Nível Máximo de intrusão.
                visibility: 1,                // Visível na tela de bloqueio.
                sound: 'emergencia',          // Toca o arquivo LONGO de 45s "emergencia.mp3" da pasta "raw".
                vibration: true               // Faz o celular tremer na mesa.
            });

            // ==========================================
            // ESCUTANDO OS EVENTOS DO CELULAR
            // ==========================================

            // LINHA 8: Quando o celular termina de se registrar no Google, ele recebe um "endereço postal" (Token).
            PushNotifications.addListener('registration', (token) => {
                // LINHA 9: Pega esse Token e envia escondido pro Render. É assim que o Render sabe o "número" do celular.
                socket.emit('registrar_token_fcm', { nome: usuario.nome, token: token.value });
            });

            // LINHA 10: O que fazer se a notificação chegar e o maqueiro estiver com o APP ABERTO olhando pra tela?
            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                // Como o app está aberto, o Android não toca o som da pasta "raw" automaticamente. 
                // LINHA 11: Então nós checamos: O dado invisível que o Render mandou diz que é "Vermelho"?
                if (notification.data && notification.data.urgencia === 'Vermelho') {
                    // LINHA 12: Se for Vermelho, a gente força a tag <audio> do HTML a tocar a sirene em loop.
                    const a2 = document.getElementById('audio-emergencia');
                    if(a2) a2.play().catch(()=>{});
                } else {
                    // LINHA 13: Se não for vermelho, toca o áudio normal do HTML.
                    const a1 = document.getElementById('audio-alerta');
                    if(a1) a1.play().catch(()=>{});
                }
            });

            // LINHA 14: O que fazer quando o maqueiro clica em cima do balão da notificação?
            PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
                // LINHA 15: Ele apenas avisa no sistema. O Android já se encarrega de abrir o aplicativo sozinho.
                // Como o app vai abrir e carregar os dados, o botão verde gigante já vai pular na tela dele.
                console.log('Notificação clicada pelo maqueiro!');
            });
        }
    } catch (e) { 
        // LINHA 16: Se der erro (ex: testando pelo PC que não tem notificação nativa), ele só avisa e não quebra o app.
        console.error("Erro nas notificações:", e); 
    }
}
// ============================================================================
// [04] UI/UX GERAL, ANIMAÇÕES E ÁUDIOS
// ============================================================================
function rodarAnimacao(textoEspera, textoSucesso, callback) {
    const overlay = document.getElementById('anim-overlay');
    const spinner = document.getElementById('anim-spinner');
    const success = document.getElementById('anim-success');
    const text = document.getElementById('anim-text');

    spinner.style.display = 'flex';
    success.style.display = 'none';
    success.classList.remove('success-pop');
    text.innerText = textoEspera;
    overlay.style.display = 'flex';

    setTimeout(() => {
        spinner.style.display = 'none';
        success.style.display = 'flex';
        success.classList.add('success-pop');
        text.innerText = textoSucesso;
        if(callback) callback();
        setTimeout(() => { overlay.style.display = 'none'; }, 2000);
    }, 800); 
}

function ativarAudio() {
    const a1 = document.getElementById('audio-alerta');
    const a2 = document.getElementById('audio-emergencia');
    try {
        if(a1) { a1.play().then(() => a1.pause()).catch(e => console.log("Áudio bloqueado", e)); }
        if(a2) { a2.play().then(() => a2.pause()).catch(e => console.log("Áudio bloqueado", e)); }
        if ('speechSynthesis' in window) { window.speechSynthesis.speak(new SpeechSynthesisUtterance('')); }
        audioLigado = true;
        const btnSom = document.getElementById('btn-som');
        if(btnSom) btnSom.style.display = 'none';
    } catch(e) { console.error("Erro no audio", e); }
}

function pararAlarme() { 
    try {
        const a1 = document.getElementById('audio-alerta');
        if (a1) { a1.pause(); a1.currentTime = 0; }
        
        const a2 = document.getElementById('audio-emergencia');
        if (a2) { a2.pause(); a2.currentTime = 0; }
        
        // Só tenta calar a voz se o sistema de voz existir no celular!
        if ('speechSynthesis' in window && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    } catch(e) {
        console.error("Erro ao parar alarme:", e);
    }
}

function falarAvisoRisco(risco) { if (!('speechSynthesis' in window)) return; window.speechSynthesis.cancel(); let texto = ""; if (risco === 'Contato') texto = "Atenção equipe. Risco de Contato. Paramente-se com luvas e avental."; else if (risco === 'Gotículas') texto = "Atenção. Risco de Gotículas. Coloque máscara cirúrgica."; else if (risco === 'Aerosol') texto = "Atenção. Risco de Aerossol. Utilize máscara N 95."; if (texto) { let locutor = new SpeechSynthesisUtterance(texto); locutor.lang = 'pt-BR'; window.speechSynthesis.speak(locutor); } }

function forcarScrollTopo() { const zeraScroll = () => { window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0; }; zeraScroll(); setTimeout(zeraScroll, 50); setTimeout(zeraScroll, 150); }
function esconderTelas() { document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); }); }

function getUrgenciaBadge(urgencia) {
    if(urgencia === 'Vermelho') return `<span class="badge badge-danger"><i class="fa fa-circle modern-icon" style="font-size:8px;"></i> Emergência</span>`;
    if(urgencia === 'Amarelo') return `<span class="badge badge-warning"><i class="fa fa-circle modern-icon" style="font-size:8px;"></i> Urgente</span>`;
    return `<span class="badge badge-success"><i class="fa fa-circle modern-icon" style="font-size:8px;"></i> Rotina</span>`;
}

function abrirPainel(u) {
    try {
        esconderTelas(); const primeiroNome = u.nome ? u.nome.split(" ")[0] : "Usuário";
        if (u.cargo === 'enfermagem') { document.getElementById('screen-nurse').classList.add('active'); document.getElementById('user-name-nurse').innerText = primeiroNome; }
        else if (u.cargo === 'coordenador') { document.getElementById('screen-coordinator').classList.add('active'); document.getElementById('user-name-coord').innerText = primeiroNome; carregarManutencao(); }
        else { document.getElementById('screen-maqueiro').classList.add('active'); document.getElementById('user-name-maq').innerText = primeiroNome; }
        atualizarFotosUI(); socket.emit('solicitar_lista'); forcarScrollTopo();
    } catch(e) { console.error("Erro crítico ao abrir painel", e); }
}

// ============================================================================
// [05] PERFIL DE USUÁRIO E FOTO
// ============================================================================
function abrirPerfil() { esconderTelas(); document.getElementById('screen-perfil').classList.add('active'); document.getElementById('perfil-nome').value = usuario.nome || ''; document.getElementById('perfil-email').value = usuario.email || ''; document.getElementById('perfil-cargo').value = usuario.cargo || ''; document.getElementById('perfil-telefone').value = usuario.telefone || ''; atualizarFotosUI(); forcarScrollTopo(); }

function fecharPerfil() { 
    abrirPainel(usuario); 
}

function atualizarFotosUI() {
    try { const fotoUrl = usuario.foto || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'; ['header-foto-nurse', 'header-foto-maq', 'header-foto-coord', 'painel-foto-maq', 'perfil-foto-preview'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).src = fotoUrl; }); if (usuario.cargo === 'maqueiro') atualizarUIStatus(usuario.status_trabalho); } catch(e) { console.error("Erro na foto", e); }
}

function lerFoto(event) { 
    const file = event.target.files[0]; 
    if (!file) return; 
    
    const reader = new FileReader(); 
    reader.onload = function(e) { 
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const tamanhoMaximo = 250; 
            let largura = img.width;
            let altura = img.height;

            if (largura > altura) {
                if (largura > tamanhoMaximo) {
                    altura *= tamanhoMaximo / largura;
                    largura = tamanhoMaximo;
                }
            } else {
                if (altura > tamanhoMaximo) {
                    largura *= tamanhoMaximo / altura;
                    altura = tamanhoMaximo;
                }
            }

            canvas.width = largura;
            canvas.height = altura;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, largura, altura);
            
            const fotoComprimida = canvas.toDataURL('image/jpeg', 0.7);
            document.getElementById('perfil-foto-preview').src = fotoComprimida;
        };
        img.src = e.target.result;
    }; 
    reader.readAsDataURL(file); 
}

function salvarPerfil() { 
    const telefone = document.getElementById('perfil-telefone').value; 
    const foto = document.getElementById('perfil-foto-preview').src; 
    
    rodarAnimacao('Salvando dados...', 'Perfil Atualizado!', () => {
        socket.emit('atualizar_perfil', { email: usuario.email, telefone, foto }); 
    });
}

socket.on('perfil_atualizado', u => { 
    usuario = u; 
    localStorage.setItem('imaqueiro_user', JSON.stringify(u)); 
    atualizarFotosUI(); 
    fecharPerfil(); 
});

// ============================================================================
// [06] ATUALIZAÇÃO E RENDERIZAÇÃO DA LISTA DE PEDIDOS (ENFERMAGEM E MAQUEIRO)
// ============================================================================
socket.on('atualizar_lista', data => { 
    pedidosAtivos = data.ativos; historicoGlobal = data.historico; 
    if (!document.getElementById('date-start') || !document.getElementById('date-start').value) {
        renderizar(data.ativos, data.historico); 
        if(usuario && usuario.cargo === 'coordenador') renderizarDashboardADM(data.ativos, data.historico, data.online); 
    }
});

function renderizar(ativos, historico) {
    try {
        const nList = document.getElementById('nurse-list'); 
        const nHist = document.getElementById('nurse-history'); 
        const mPendentes = document.getElementById('maqueiro-pendentes'); 
        const mAtivo = document.getElementById('maqueiro-ativo'); 
        
        if(!usuario) return; 
        if(nList) nList.innerHTML = ""; 
        if(nHist) nHist.innerHTML = ""; 
        if(mPendentes) mPendentes.innerHTML = ""; 
        if(mAtivo) mAtivo.innerHTML = ""; 
        
        let callNow = false; let contHoje = 0; let temAtivo = false; let cPendente = 0, cCurso = 0, cRisco = 0;

        if (ativos.length === 0 && usuario.cargo === 'enfermagem' && nList) { nList.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fa fa-coffee modern-icon"></i><p>Tudo limpo por aqui. Nenhum transporte ativo.</p></div>`; }
        if (ativos.length === 0 && usuario.cargo === 'maqueiro' && mPendentes) { mPendentes.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fa fa-bed modern-icon"></i><p>Pátio livre. Aguardando chamados.</p></div>`; }

        ativos.forEach(p => {
            if (p.status === 'cancelado' || p.status === 'finalizado') return;
            if (p.status === 'agendado' && usuario.cargo === 'maqueiro') return;

            const borderRisco = p.risco_assistencial !== 'Nenhum' ? 'border-left-color: var(--danger);' : 'border-left-color: var(--primary);';
            const badgeRisco = p.risco_assistencial !== 'Nenhum' ? `<span class="badge badge-danger"><i class="fa fa-biohazard modern-icon"></i> ${p.risco_assistencial}</span>` : "";
            if(p.risco_assistencial !== 'Nenhum') cRisco++; 
            if(p.status === 'pendente') cPendente++; else cCurso++;

            const tempoBadge = p.status === 'pendente' || p.status === 'aceito' ? `<div class="sla-timer sla-badge" data-time="${p.criado_em || new Date().toISOString()}"><i class="fa fa-clock modern-icon"></i> 0 min</div>` : '';

            let isRetorno = p.status.includes('retorno');
            let telaOrigem = isRetorno ? p.destino : p.origem;
            let telaDestino = isRetorno ? p.origem : p.destino;
            let badgeRetorno = isRetorno ? `<span style="background: var(--warning); color: #FFF; padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 0.75rem; display: inline-block; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(245,158,11,0.4);"><i class="fa fa-undo modern-icon"></i> ROTA DE VOLTA</span><br>` : '';

            let badgeEquipe = '';
            if (p.risco_transporte === 'Alto') {
                badgeEquipe = `<div style="margin-top:8px; background:var(--danger-light); color:var(--danger-dark); padding:6px 8px; border-radius:6px; font-size:0.75rem; font-weight:800; border: 1px solid var(--danger);"><i class="fa fa-user-md modern-icon"></i> EXIGE EQUIPE MÉDICA (Alto Risco)</div>`;
            } else if (p.risco_transporte === 'Médio') {
                badgeEquipe = `<div style="margin-top:8px; background:var(--warning-light); color:var(--warning-dark); padding:6px 8px; border-radius:6px; font-size:0.75rem; font-weight:800; border: 1px solid var(--warning);"><i class="fa fa-user-nurse modern-icon"></i> EXIGE ENF/MÉDICO (Médio Risco)</div>`;
            }

            const cardBase = `<div class="card" style="${borderRisco}"><button onclick="abrirDetalhes(${p.id})" style="position:absolute; right:15px; top:15px; border:none; background:none; cursor:pointer; font-size:1.2rem; color:var(--text-muted); transition:0.2s;"><i class="fa fa-wheelchair modern-icon"></i></button>${badgeRetorno}<div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:12px; padding-right:30px;"><b style="font-size:1.15rem; letter-spacing:-0.5px; color:${isRetorno ? 'var(--warning-dark)' : 'inherit'};">${telaOrigem} ➔ ${telaDestino}</b></div><div style="display:flex; gap:8px; margin-bottom: 12px; flex-wrap:wrap;">${getUrgenciaBadge(p.urgencia)} ${badgeRisco} ${tempoBadge}</div><div style="font-size:0.95rem; margin-bottom:6px; font-weight:500;"><i class="fa fa-user modern-icon" style="color:var(--text-muted); width:15px;"></i> ${p.paciente}</div><div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:4px; font-weight:500;"><i class="fa fa-wheelchair modern-icon" style="width:15px;"></i> ${p.tipo}</div> ${badgeEquipe} <button onclick="abrirChat(${p.id})" style="position:absolute; right:15px; bottom:15px; border:none; background:var(--primary-light); width:38px; height:38px; border-radius:50%; cursor:pointer; transition:0.2s;"><i class="fa fa-comment modern-icon" style="color:var(--primary-hover)"></i></button>`;

            // ==========================================
            // LÓGICA DA ENFERMAGEM (BOTÃO RESTAURADO)
            // ==========================================
            if(usuario.cargo === 'enfermagem' && nList) {
                let botoesExtras = "";
                let statusText = "Aguardando maqueiro...";
                
                if (p.status === 'pendente') {
                    // SE O PACIENTE NÃO ESTIVER PRONTO, MOSTRA O BOTÃO AZUL
                    if (!p.pronto_pela_enfermagem) {
                        statusText = "Aguardando preparo do paciente";
                        botoesExtras += `<button class="btn btn-main" style="margin-top:12px; background:var(--primary); font-size:0.9rem;" onclick="socket.emit('paciente_pronto', ${p.id})"><i class="fa fa-thumbs-up modern-icon"></i> PACIENTE PRONTO</button>`;
                    } else {
                        statusText = "Paciente pronto. Aguardando maqueiro...";
                    }
                } else if (p.status === 'agendado') {
                    const dataFormatada = new Date(p.data_agendamento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                    statusText = `<b><i class="fa fa-calendar modern-icon"></i> Agendado para: ${dataFormatada}</b>`;
                } else if (p.status === 'aguardando_equipamento' || p.status === 'aguardando_equipamento_retorno') {
                    statusText = "Maqueiro buscando maca/cadeira...";
                } else if (p.status === 'aceito' || p.status === 'aceito_retorno') {
                    statusText = "Maqueiro a caminho do leito!";
                } else if (p.status === 'na_origem' || p.status === 'na_origem_retorno') {
                    statusText = "Maqueiro chegou no paciente.";
                } else if (p.status === 'em_transito_ida' || p.status === 'em_transito_retorno') {
                    statusText = "Em trânsito para o destino ➔";
                } else if (p.status === 'no_destino' || p.status === 'no_destino_retorno') {
                    statusText = "Paciente entregue no destino!";
                    if(p.trajeto === 'ida_volta' && p.status === 'no_destino') { 
                        botoesExtras += `<button class="btn btn-main" style="margin-top:12px; background:var(--success); font-size:0.9rem;" onclick="socket.emit('pedir_retorno', ${p.id})"><i class="fa fa-undo modern-icon"></i> EXIGIR RETORNO</button>`; 
                    }
                } else if (p.status === 'aguardando_retorno') {
                    statusText = "Aguardando maqueiro para retorno...";
                }

                if (p.status === 'pendente' || p.status === 'agendado' || p.status === 'aguardando_equipamento' || p.status === 'aguardando_retorno') {
                    botoesExtras += `<button class="btn" style="margin-top:10px; width:100%; background:var(--danger-light); color:var(--danger-dark); font-size:0.9rem; border: 1px solid var(--danger);" onclick="abrirModalCancelamento(${p.id})"><i class="fa fa-times modern-icon"></i> CANCELAR CHAMADO</button>`;
                } else if (p.status === 'no_destino' || p.status === 'no_destino_retorno')    {
                    botoesExtras += `<button class="btn" style="margin-top:10px; width:100%; background:var(--success-light); color:var(--success-dark); font-size:0.9rem; border: 1px solid var(--success);" onclick="abrirAvaliacao(${p.id})"><i class="fa fa-check-circle modern-icon"></i> FINALIZAR ATENDIMENTO</button>`;
                }

                let progress = 0;
                let c1 = '', c2 = '', c3 = '', c4 = '';
                let icon1 = 'fa-clipboard-list', icon2 = 'fa-running', icon3 = 'fa-procedures', icon4 = 'fa-flag-checkered';

                if (p.status === 'pendente' || p.status === 'agendado') { 
                    c1 = 'active'; progress = 0; 
                }
                else if (p.status.includes('aceito') || p.status.includes('aguardando_equip')) { 
                    c1 = 'completed'; c2 = 'active'; icon2 = 'fa-running fa-flip'; progress = 33; 
                }
                else if (p.status.includes('na_origem')) { 
                    c1 = 'completed'; c2 = 'completed'; c3 = 'active'; icon3 = 'fa-procedures fa-fade'; progress = 66; 
                }
                else if (p.status.includes('em_transito')) { 
                    c1 = 'completed'; c2 = 'completed'; c3 = 'completed'; c4 = 'active'; icon4 = 'fa-ambulance fa-shake'; progress = 85; 
                }
                else if (p.status.includes('no_destino')) { 
                    c1 = 'completed'; c2 = 'completed'; c3 = 'completed'; c4 = 'completed'; progress = 100; 
                }

                let statusBox = `<div class="hospital-tracker"><div class="track-line-bg"></div><div class="track-line-fill" style="width: ${progress}%;"></div><div class="track-step ${c1}"><div class="track-icon"><i class="fa ${icon1} modern-icon"></i></div><div class="track-label">Pedido</div></div><div class="track-step ${c2}"><div class="track-icon"><i class="fa ${icon2} modern-icon"></i></div><div class="track-label">A Caminho</div></div><div class="track-step ${c3}"><div class="track-icon"><i class="fa ${icon3} modern-icon"></i></div><div class="track-label">No Leito</div></div><div class="track-step ${c4}"><div class="track-icon"><i class="fa ${icon4} modern-icon"></i></div><div class="track-label">Entregue</div></div></div><div style="text-align:center; color:var(--primary-hover); font-size:0.9rem; font-weight:800; margin-top:12px; background: var(--primary-light); padding: 10px; border-radius: 8px;"><i class="fa fa-info-circle modern-icon"></i> ${statusText}</div>`;

                nList.innerHTML += `<div style="margin-bottom:20px;">${cardBase} ${statusBox} <div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px; text-align:center; font-weight:500;">Responsável: <b>${p.maqueiro_ida || 'Aguardando...'}</b></div>${botoesExtras}</div></div>`;
            }
            
            // ==========================================
            // LÓGICA DO MAQUEIRO (GATILHO DO CHAMADO)
            // ==========================================
            if(usuario.cargo === 'maqueiro') {
                const isPendente = p.status === 'pendente' || p.status === 'aguardando_retorno'; 
                const isMeu = p.maqueiro_ida === usuario.nome || p.maqueiro_volta === usuario.nome;
                
                if(isPendente && mPendentes) {
                    // Verifica se a enfermagem já apertou o botão "Paciente Pronto"
                    let pacienteEstaPronto = p.pronto_pela_enfermagem || isRetorno; 
                    
                    let btnText = "AGUARDANDO PREPARO";
                    let btnColor = "#CBD5E1";
                    let blockClick = true;

                    if (pacienteEstaPronto) {
                        btnText = "ACEITAR CHAMADO";
                        btnColor = "var(--success)";
                        blockClick = false;

                        // DISPARA A TELA GIGANTE E A SIRENE!
                        // Só dispara se o maqueiro estiver disponível e não rejeitou
                        if(usuario.status_trabalho !== 'intervalo' && !chamadosRejeitados.includes(p.id)) {
                            callNow = true; idChamadoAtual = p.id; 
                            document.getElementById('call-paciente').innerText = p.paciente; 
                            document.getElementById('call-rota').innerText = telaOrigem + " ➔ " + telaDestino; 
                            document.getElementById('call-equip').innerText = p.tipo; 
                            
                            const faixaRisco = document.getElementById('call-risco-faixa'); 
                            const imgRisco = document.getElementById('img-aviso-risco'); 
                            const iconeSirene = document.getElementById('icone-sirene');
                            
                            if (p.risco_assistencial !== 'Nenhum') { 
                                faixaRisco.style.display = 'block'; imgRisco.style.display = 'block'; iconeSirene.style.display = 'none'; 
                                if(p.risco_assistencial === 'Contato') imgRisco.src = '/img-contato.png'; 
                                else if (p.risco_assistencial === 'Gotículas') imgRisco.src = '/img-goticulas.png'; 
                                else if (p.risco_assistencial === 'Aerosol') imgRisco.src = '/img-aerosol.png'; 
                            } else { 
                                faixaRisco.style.display = 'none'; imgRisco.style.display = 'none'; iconeSirene.style.display = 'block'; 
                            }
                            
                            if(audioLigado) { 
                                if (p.urgencia === 'Vermelho') document.getElementById('audio-emergencia').play().catch(()=>{}); 
                                else document.getElementById('audio-alerta').play().catch(()=>{}); 
                                if (p.risco_assistencial !== 'Nenhum') setTimeout(() => falarAvisoRisco(p.risco_assistencial), 1000); 
                            }
                        }
                    }
                    
                    let estiloBotao = `background:${btnColor}; color: ${blockClick ? 'var(--text-muted)' : 'white'}; font-weight:800;`;
                    if (!blockClick) estiloBotao += " box-shadow:0 4px 15px rgba(16,185,129,0.3);";
                    
                    mPendentes.innerHTML += `${cardBase}<span class="badge badge-preparo" style="margin-bottom:8px; display:${pacienteEstaPronto ? 'none' : 'inline-block'}">EM PREPARO</span><br><button class="btn btn-main" style="${estiloBotao} margin-top:15px; width:100%;" onclick="aceitarChamadoManual(${p.id})" ${blockClick ? 'disabled' : ''}><i class="fa fa-hand-paper modern-icon"></i> ${btnText}</button></div>`;
                } 
                else if (isMeu && mAtivo) {
                    temAtivo = true; let btnAcao = "";
                    
                    if(p.status === 'aceito' || p.status === 'aceito_retorno') {
                        btnAcao = `<button class="btn btn-main" style="margin-top:15px; width:100%;" onclick="abrirQR(${p.id})"><i class="fa fa-qrcode modern-icon"></i> LER QR DO LEITO</button>`;
                        btnAcao += `<button class="btn" style="margin-top:10px; width:100%; background:var(--warning-light); color:var(--warning-dark); border: 1px solid var(--warning);" onclick="socket.emit('cheguei_origem', ${p.id})"><i class="fa fa-forward modern-icon"></i> [TESTE] PULAR QR CODE</button>`;
                        btnAcao += `<button class="btn" style="margin-top:10px; width:100%; background:#F1F5F9; color:#64748B; border: 1px solid var(--border-color);" onclick="socket.emit('esperar_equipamento', ${p.id})"><i class="fa fa-hourglass-start modern-icon"></i> SEM CADEIRA/MACA AGORA</button>`;
                    }
                    else if(p.status === 'aguardando_equipamento' || p.status === 'aguardando_equipamento_retorno') btnAcao = `<button class="btn" style="margin-top:15px; width:100%; background:var(--success); color:white;" onclick="socket.emit('equipamento_conseguido', ${p.id})"><i class="fa fa-play modern-icon"></i> CONSEGUI O EQUIPAMENTO</button>`;
                    else if(p.status === 'na_origem' || p.status === 'na_origem_retorno') btnAcao = `<button class="btn" style="background:var(--warning); margin-top:15px; width:100%; color:var(--warning-dark);" onclick="abrirChecklist(${p.id})"><i class="fa fa-wheelchair modern-icon"></i> INICIAR ROTA</button>`;
                    else if(p.status === 'em_transito_ida' || p.status === 'em_transito_retorno') btnAcao = `<button class="btn" style="background:var(--success); color:white; margin-top:15px; width:100%;" onclick="socket.emit('entregue_destino', ${p.id})"><i class="fa fa-check-circle modern-icon"></i> CONFIRMAR ENTREGA</button>`;
                    
                    btnAcao += `<button class="btn" style="background:var(--danger); color:white; margin-top:10px; width:100%; border: 2px solid #7F1D1D;" onclick="emitirSOS(${p.id})"><i class="fa fa-triangle-exclamation fa-beat modern-icon"></i> CÓDIGO AZUL / SOS</button>`;

                    mAtivo.innerHTML += `${cardBase}${btnAcao}</div>`;
                }
            }
        });

        if(usuario.cargo === 'enfermagem') { 
            document.getElementById('stat-pendente').innerText = cPendente; 
            document.getElementById('stat-curso').innerText = cCurso; 
            document.getElementById('stat-risco').innerText = cRisco; 
        }
        
        if(usuario.cargo === 'enfermagem' && nHist) {
            if (historico.length === 0) { nHist.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 20px;"><p>Nenhum histórico recente.</p></div>`; } 
            else {
                historico.slice(0, 10).forEach(p => {
                    nHist.innerHTML += `
                    <div class="card" style="border-left-color: #CBD5E1; opacity: 0.85; background: var(--input-bg);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                            <b style="font-size:1.05rem; color: var(--text-muted);">${p.origem} ➔ ${p.destino}</b>
                        </div>
                        <div style="font-size:0.95rem; margin-bottom:12px; font-weight: 500;"><i class="fa fa-user modern-icon" style="color:var(--text-muted);"></i> ${p.paciente}</div>
                        <button class="btn" style="width:100%; background:var(--warning-light); color:var(--warning-dark); font-size:0.9rem; border: 1px solid var(--warning);" onclick="rechamarPaciente('${p.paciente}', '${p.destino}', '${p.tipo}')">
                            <i class="fa fa-redo modern-icon"></i> RECHAMAR PACIENTE
                        </button>
                    </div>`;
                });
            }
        }

        const mHistModal = document.getElementById('maqueiro-history-modal');
        if(usuario.cargo === 'maqueiro' && mHistModal) {
            mHistModal.innerHTML = "";
            document.getElementById('area-corrida-ativa').style.display = temAtivo ? 'block' : 'none'; 
            atualizarUIStatus(usuario.status_trabalho, temAtivo);
            
            if (historico.filter(x => x.maqueiro_ida === usuario.nome || x.maqueiro_volta === usuario.nome).length === 0) { 
                mHistModal.innerHTML = `<div class="empty-state" style="padding: 20px;"><i class="fa fa-bed modern-icon" style="font-size:2.5rem; margin-bottom:10px;"></i><p style="font-size:0.9rem;">Nenhuma corrida finalizada hoje.</p></div>`; 
            }
            
            historico.forEach(p => { 
                if(p.maqueiro_ida === usuario.nome || p.maqueiro_volta === usuario.nome) { 
                    contHoje++; 
                    mHistModal.innerHTML += `
                    <div style="background:var(--card-bg); padding:16px; border-radius:12px; margin-bottom:12px; border-left:4px solid var(--success); display:flex; justify-content:space-between; align-items:center; box-shadow:var(--shadow-sm); border: 1px solid var(--border-color);">
                        <div><b style="font-size:0.95rem;">${p.origem} ➔ ${p.destino}</b><br><span style="color:var(--text-muted); font-size:0.85rem; font-weight:500;"><i class="fa fa-user modern-icon" style="font-size:0.7rem;"></i> ${p.paciente}</span></div>
                        <i class="fa fa-check-circle modern-icon" style="color:var(--success); font-size:1.5rem;"></i>
                    </div>`; 
                } 
            });
            document.getElementById('total-hoje').innerText = contHoje;
        }
        
        if (callNow && usuario && usuario.cargo === 'maqueiro') {
            const modal = document.getElementById('call-modal');
            if (modal.style.display !== 'flex') { 
                modal.style.display = 'flex';
                iniciarTimerDespacho();
            }
        } else {
            document.getElementById('call-modal').style.display = 'none';
            clearInterval(timerDespacho);
        }
        
    } catch(e) { console.error("Erro ao renderizar dados", e); }
}


// ============================================================================
// [07] ROTINAS DE ENFERMAGEM E PEDIDOS
// ============================================================================
function mudarAbaPedido(modo) {
    modoPedidoAtual = modo;
    const btnImediato = document.getElementById('btn-tab-imediato');
    const btnAgendado = document.getElementById('btn-tab-agendado');
    const boxAgendamento = document.getElementById('box-agendamento');
    
    if(modo === 'imediato') {
        btnImediato.style.background = 'var(--primary)';
        btnImediato.style.color = 'white';
        btnAgendado.style.background = 'transparent';
        btnAgendado.style.color = 'var(--text-muted)';
        boxAgendamento.style.display = 'none';
        document.getElementById('data_agendamento').value = '';
    } else {
        btnAgendado.style.background = 'var(--warning)';
        btnAgendado.style.color = 'var(--warning-dark)';
        btnImediato.style.background = 'transparent';
        btnImediato.style.color = 'var(--text-muted)';
        boxAgendamento.style.display = 'block';
    }
}

async function enviarPedido() {
    try {
        const checkboxes = document.querySelectorAll('.cb-disp:checked'); 
        let selecionados = Array.from(checkboxes).map(cb => cb.value); 
        let obs = document.getElementById('obs').value; 
        let dataAgendamento = document.getElementById('data_agendamento').value;
        const urgencia = document.getElementById('urgencia').value;
        
        if (modoPedidoAtual === 'agendado' && !dataAgendamento) {
            return Swal.fire('Atenção', 'Por favor, selecione a data e o horário para o agendamento!', 'warning');
        }

        let dataISO = null;
        if (dataAgendamento) {
            dataISO = new Date(dataAgendamento).toISOString();
        }

        if(selecionados.includes('VNI')) {
            return Swal.fire({
                icon: 'error',
                title: 'Transporte Contraindicado',
                text: 'Protocolo PR.QAS.006: O transporte com VNI é contraindicado. Suspenda a VNI, instale máscara não reinalante e aguarde 45 min de estabilidade.',
                confirmButtonColor: '#4F46E5'
            });
        }

        if(selecionados.includes('Confuso/Agitado') || selecionados.includes('Confuso')) {
            const confirmacao = await Swal.fire({
                icon: 'warning',
                title: 'Paciente Agitado (PR.QAS.006)',
                text: 'Você confirma que a medida de contenção (medicamentosa ou mecânica) foi prescrita pelo médico e já foi aplicada?',
                showCancelButton: true,
                confirmButtonText: 'Sim, Contenção Aplicada',
                cancelButtonText: 'Cancelar Solicitação',
                confirmButtonColor: '#10B981',
                cancelButtonColor: '#64748B'
            });
            
            if(!confirmacao.isConfirmed) {
                return Swal.fire('Cancelado', 'Providencie a contenção antes de pedir o transporte.', 'info');
            }
            obs = "[CONTENÇÃO CONFIRMADA] " + obs;
        }

        if(selecionados.includes('Ventilação Mecânica') || selecionados.includes('Droga Vasoativa')) {
            const confirmacaoMaleta = await Swal.fire({
                icon: 'warning',
                title: 'Alto Risco (POP 004/2018)',
                html: 'O paciente exige monitorização rigorosa.<br><br>Confirma que a <b>Maleta de Transporte</b> (laringoscópio, drogas de parada) foi checada e acompanhará o paciente?',
                showCancelButton: true,
                confirmButtonText: 'Sim, Maleta Checada',
                cancelButtonText: 'Ainda não, cancelar',
                confirmButtonColor: '#10B981',
                cancelButtonColor: '#EF4444'
            });
            
            if(!confirmacaoMaleta.isConfirmed) {
                return Swal.fire('Atenção', 'Cheque a Maleta de Transporte de Alto Risco antes de acionar a equipe.', 'error');
            }
            obs = "[MALETA DE ALTO RISCO CHECADA] " + obs;
        }

        if (urgencia === 'Verde') {
            const agora = new Date();
            const hora = agora.getHours();
            const min = agora.getMinutes();
            const tempoDecimal = hora + (min / 60);

            const naTrocaDePlantao = (tempoDecimal >= 6.5 && tempoDecimal <= 7.5) || (tempoDecimal >= 18.5 && tempoDecimal <= 19.5);

            if (naTrocaDePlantao) {
                const confirmacaoPlantao = await Swal.fire({
                    icon: 'info',
                    title: 'Troca de Plantão',
                    html: 'Segundo o POP 004/2018, transportes de rotina devem ser evitados neste horário.<br><br><b>Este paciente não pode aguardar?</b>',
                    showCancelButton: true,
                    confirmButtonText: 'Não, pedir agora',
                    cancelButtonText: 'Pode aguardar (Cancelar)',
                    confirmButtonColor: '#F59E0B',
                    cancelButtonColor: '#64748B'
                });

                if (!confirmacaoPlantao.isConfirmed) {
                    return Swal.fire('Adiado', 'Agradecemos a colaboração com o fluxo do hospital!', 'success');
                }
                obs = "[LIBERADO NA TROCA DE PLANTÃO] " + obs;
            }
        }

        let dispositivosFinal = selecionados.join(', '); 
        if(obs) dispositivosFinal += (dispositivosFinal ? " | " : "") + obs; 
        if(!dispositivosFinal) dispositivosFinal = "Nenhuma observação reportada.";
        
        const d = { 
            paciente: document.getElementById('paciente').value, 
            origem: document.getElementById('origem').value, 
            destino: document.getElementById('destino').value, 
            tipo: document.getElementById('tipo').value, 
            urgencia: document.getElementById('urgencia').value, 
            trajeto: document.getElementById('trajeto').value, 
            risco_assistencial: document.getElementById('risco').value, 
            dispositivos: dispositivosFinal,
            data_agendamento: dataISO 
        };
        
        if(!d.paciente || !d.origem || !d.destino) {
            return Swal.fire('Ops!', 'Preencha origem, destino e nome do paciente!', 'warning');
        }
        
        rodarAnimacao('Enviando chamado...', 'Chamado Solicitado!', () => {
            socket.emit('novo_pedido', d); 
            document.getElementById('paciente').value = ""; document.getElementById('origem').value = ""; document.getElementById('destino').value = ""; document.getElementById('obs').value = ""; document.getElementById('data_agendamento').value = ""; checkboxes.forEach(cb => cb.checked = false); window.scrollTo(0,0);
            if(typeof mudarAbaPedido === 'function') mudarAbaPedido('imediato');
        });
        
    } catch(e) { console.error("Erro ao enviar pedido", e); }
}

socket.on('alerta_preparo', p => {
    if (usuario && usuario.cargo === 'enfermagem' && !alertasMostrados.has(p.id)) {
        alertasMostrados.add(p.id); 
        
        const a2 = document.getElementById('audio-alerta');
        if(a2) a2.play().catch(()=>{});
        
        document.getElementById('toast-autor').innerText = '⏰ AVISO DE PREPARO';
        document.getElementById('toast-msg').innerHTML = `O transporte de <b>${p.paciente}</b> será acionado em 10 minutos! Inicie o preparo.`;
        document.getElementById('toast').style.display = 'flex';
        document.getElementById('toast').style.background = 'var(--warning)';
        document.getElementById('toast').style.color = 'var(--warning-dark)';
        document.getElementById('toast').style.borderLeft = '10px solid var(--warning-dark)';
        
        setTimeout(() => {
            document.getElementById('toast').style.display='none';
            document.getElementById('toast').style.background = 'var(--header-bg)'; 
            document.getElementById('toast').style.color = 'white'; 
        }, 12000);
    }
});

function abrirDetalhes(id) {
    try { 
        const p = pedidosAtivos.find(x => x.id === id) || historicoGlobal.find(x => x.id === id); 
        if (!p) return; 
        
        let badgeEq = '';
        if(p.risco_transporte === 'Alto') badgeEq = `<span class="badge badge-danger" style="margin-left: 8px;">Alto Risco</span>`;
        else if(p.risco_transporte === 'Médio') badgeEq = `<span class="badge badge-warning" style="margin-left: 8px;">Médio Risco</span>`;
        else badgeEq = `<span class="badge" style="background:#E2E8F0;color:#64748B; margin-left: 8px;">Baixo Risco</span>`;

        document.getElementById('details-body').innerHTML = `
            <div style="margin-bottom:20px; font-size:1rem;"><b>Nome:</b> ${p.paciente}<br><b>Origem:</b> ${p.origem}<br><b>Destino:</b> ${p.destino}<br><b>Modalidade:</b> ${p.tipo}<br><b>Prioridade:</b> ${p.urgencia}<br><b>Precaução:</b> ${p.risco_assistencial}</div>
            <div style="background:var(--danger-light); padding:15px; border-left:4px solid var(--danger); border-radius:8px; margin-bottom:15px;">
                <b style="color:var(--danger-dark)"><i class="fa fa-exclamation-circle modern-icon"></i> Condições e Dispositivos:</b><br>
                <span style="color:var(--danger-dark); font-weight:500;">${p.dispositivos || 'Paciente Padrão.'}</span>
            </div>
            <div style="background:var(--input-bg); padding:15px; border:1px solid var(--border-color); border-radius:8px;">
                <b style="color:var(--text-main)"><i class="fa fa-users modern-icon"></i> Equipe Mínima (POP 004/2018):</b> ${badgeEq}<br>
                <span style="color:var(--primary); font-weight:800; font-size: 0.95rem; display: block; margin-top: 8px;">${p.equipe_minima || 'Téc. de Enfermagem + Maqueiro'}</span>
            </div>
        `; 
        document.getElementById('details-modal').style.display = 'flex'; 
    } catch(e) { console.error("Erro em detalhes", e); }
}

function abrirModalCancelamento(id) {
    idChamadoParaCancelar = id;
    document.getElementById('cancel-motivo').value = ''; 
    document.getElementById('cancel-obs').value = '';
    const modalBox = document.querySelector('#cancel-modal .modal-content');
    if (modalBox) modalBox.style.border = '1px solid var(--border-color)'; 
    document.getElementById('cancel-modal').style.display = 'flex';
}

function confirmarCancelamento() {
    if (!idChamadoParaCancelar) return;

    const motivo = document.getElementById('cancel-motivo').value;
    const obs = document.getElementById('cancel-obs').value;
    const modalBox = document.querySelector('#cancel-modal .modal-content');

    if (!motivo || (motivo === 'Outro' && !obs.trim())) {
        if (modalBox) {
            modalBox.style.animation = 'none'; 
            void modalBox.offsetWidth; 
            modalBox.style.animation = 'shake 0.4s ease-in-out';
            modalBox.style.border = '2px solid var(--danger)';
        }
        
        document.getElementById('toast-autor').innerText = 'Atenção';
        document.getElementById('toast-msg').innerText = !motivo ? 'Selecione um motivo!' : 'Descreva o motivo na observação!';
        document.getElementById('toast').style.display = 'flex';
        document.getElementById('toast').style.borderLeft = '5px solid var(--danger)';
        setTimeout(() => document.getElementById('toast').style.display='none', 3000);
        return; 
    }

    const justificativaFinal = obs ? `${motivo} - ${obs}` : motivo;
    
    socket.emit('cancelar_pedido', { 
        id: idChamadoParaCancelar, 
        motivo: justificativaFinal, 
        autor: usuario.nome 
    });
    
    document.getElementById('cancel-modal').style.display = 'none';
    if (modalBox) modalBox.style.border = '1px solid var(--border-color)';
    idChamadoParaCancelar = null;

    document.getElementById('toast-autor').innerText = 'Sistema';
    document.getElementById('toast-msg').innerText = 'Chamado cancelado com sucesso.';
    document.getElementById('toast').style.display = 'flex';
    document.getElementById('toast').style.borderLeft = '5px solid var(--success)';
    setTimeout(() => document.getElementById('toast').style.display='none', 3000);
}

function rechamarPaciente(nome, novaOrigem, equipamento) {
    document.getElementById('paciente').value = nome;
    document.getElementById('origem').value = novaOrigem;
    document.getElementById('destino').value = ""; 
    document.getElementById('tipo').value = equipamento;
    
    window.scrollTo(0, 0);
    document.getElementById('destino').focus();
    
    document.getElementById('toast-autor').innerText = 'Sistema';
    document.getElementById('toast-msg').innerText = 'Dados recuperados! Digite o novo destino.';
    document.getElementById('toast').style.display = 'flex';
    setTimeout(() => document.getElementById('toast').style.display='none', 3000);
}

function abrirAvaliacao(id) {
    Swal.fire({
        title: 'Transporte Concluído!',
        text: 'O maqueiro confirmou a entrega do paciente. Deseja encerrar este chamado e enviar para o histórico?',
        icon: 'success',
        showCancelButton: true,
        confirmButtonColor: '#10B981',
        cancelButtonColor: '#64748B',
        confirmButtonText: '<i class="fa fa-check-circle"></i> Sim, Encerrar Chamado',
        cancelButtonText: 'Ainda não'
    }).then((result) => {
        if (result.isConfirmed) {
            socket.emit('avaliar_pedido', { id: id, nota: 5, obs: 'Finalizado com sucesso' });
            socket.emit('finalizar_pedido', id);
        }
    });
}

function enviarAvaliacao() {
    if (notaAtual === 0) return alert('Por favor, selecione pelo menos 1 estrela para avaliar.');
    socket.emit('finalizar_geral', idChamadoParaAvaliar);
    document.getElementById('rating-modal').style.display = 'none';
    document.getElementById('toast-autor').innerText = 'Sistema de Qualidade'; document.getElementById('toast-msg').innerText = 'Avaliação de ' + notaAtual + ' estrelas salva com sucesso!';
    document.getElementById('toast').style.display = 'flex'; document.getElementById('toast').style.borderLeft = '5px solid var(--success)';
    setTimeout(() => document.getElementById('toast').style.display='none', 4000);
}

function pularAvaliacao() { socket.emit('finalizar_geral', idChamadoParaAvaliar); document.getElementById('rating-modal').style.display = 'none'; }


// ============================================================================
// [08] ROTINAS DO MAQUEIRO (ACEITE, QR CODE E CHECKLIST)
// ============================================================================
function iniciarTimerDespacho() {
    clearInterval(timerDespacho);
    tempoRestanteDespacho = 15;
    const barra = document.getElementById('progress-bar');
    const texto = document.getElementById('timer-text');
    
    barra.style.width = '100%';
    texto.innerText = '15s';
    
    timerDespacho = setInterval(() => {
        tempoRestanteDespacho--;
        texto.innerText = tempoRestanteDespacho + 's';
        barra.style.width = (tempoRestanteDespacho / 15 * 100) + '%';
        
        if(tempoRestanteDespacho <= 0) {
            passarVezCall(); 
        }
    }, 1000);
}

window.aceitarChamadoBotao = function() {
    try {
        const idParaAceitar = idChamadoAtual;
        if (!idParaAceitar) { Swal.fire('Erro', 'ID do chamado perdido. Recarregue o app.', 'error'); return; }

        clearInterval(timerDespacho); 
        pararAlarme(); 
        
        socket.emit('aceitar_chamado', { idPedido: idParaAceitar, nomeMaqueiro: usuario.nome }); 

        document.getElementById('call-modal').style.display = 'none';
        
        Swal.fire({
            title: 'Aceito!',
            text: 'Transporte atribuído a você.',
            icon: 'success',
            toast: true,
            position: 'top-end',
            timer: 3000,
            showConfirmButton: false
        });
    } catch (erro) {
        console.error(erro);
        alert("Erro no botão: " + erro.message); 
    }
};

function aceitarChamadoManual(id) { socket.emit('aceitar_chamado', { idPedido: id, nomeMaqueiro: usuario.nome }); }

function passarVezCall() { 
    clearInterval(timerDespacho); 
    pararAlarme(); 
    chamadosRejeitados.push(idChamadoAtual); 
    document.getElementById('call-modal').style.display = 'none'; 
    socket.emit('rejeitar_pedido', idChamadoAtual); 
}

window.abrirQR = function(id) { 
    document.getElementById('qr-modal').style.display = 'flex'; 
    html5QrCode = new Html5Qrcode("qr-reader"); 
    
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (txt) => { 
        fecharQR(); 
        if('vibrate' in navigator) navigator.vibrate(100);
        Swal.fire({
            icon: 'success', title: 'Leito Confirmado!', text: 'Paciente localizado.', toast: true, position: 'top-end', timer: 3000, showConfirmButton: false
        });
        socket.emit('cheguei_origem', id); 
    }, (erro_de_leitura) => {
    }).catch((err) => {
        console.error("Erro ao abrir câmera", err);
        Swal.fire('Erro', 'Não foi possível acessar a lente da câmera.', 'error');
    }); 
};

window.fecharQR = function() { 
    if(html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
        }).catch((e) => console.log("Câmera já parada", e));
    }
    document.getElementById('qr-modal').style.display = 'none'; 
};

function abrirChecklist(id) { 
    idChecklistAtual = id; 
    const p = pedidosAtivos.find(x => x.id === id);
    if(!p) return;
    
    let htmlChecklist = `
        <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:15px; font-weight: 500;">Confirme os itens obrigatórios (POP 004/2018):</p>
        <div style="background:var(--input-bg); padding:15px; border-radius:12px; border: 1px solid var(--border-color); margin-bottom:15px;">
            <label style="display:flex; align-items:start; gap:10px; margin-bottom:12px; font-size:0.9rem; font-weight: 600; cursor: pointer; text-transform:none;">
                <input type="checkbox" class="check-seguranca" onchange="validarChecklist()" style="margin-top:2px;"> 
                Pulseira de Identificação conferida
            </label>
            <label style="display:flex; align-items:start; gap:10px; margin-bottom:12px; font-size:0.9rem; font-weight: 600; cursor: pointer; text-transform:none;">
                <input type="checkbox" class="check-seguranca" onchange="validarChecklist()" style="margin-top:2px;"> 
                <span><b>Prontuário, BIA e Prescrição do dia</b> em mãos</span>
            </label>
            <label style="display:flex; align-items:start; gap:10px; font-size:0.9rem; font-weight: 600; cursor: pointer; text-transform:none; margin:0;">
                <input type="checkbox" class="check-seguranca" onchange="validarChecklist()" style="margin-top:2px;"> 
                Sondas, Drenos e O2 seguros (ou Não se Aplica)
            </label>
        </div>
    `;

    if (p.risco_assistencial && p.risco_assistencial !== 'Nenhum') {
        let epi = '';
        if (p.risco_assistencial === 'Contato') epi = 'Avental Descartável + Luvas';
        else if (p.risco_assistencial === 'Gotículas') epi = 'Máscara Cirúrgica';
        else if (p.risco_assistencial === 'Aerosol' || p.risco_assistencial === 'Aerossóis') epi = 'Máscara N-95';
        else if (p.risco_assistencial === 'Reverso') epi = 'Luvas + Avental + Máscara Cirúrgica';

        if (epi) {
            htmlChecklist += `
            <div style="background:var(--warning-light); border: 1px solid var(--warning); border-radius: 12px; padding: 15px; margin-bottom: 15px; color: var(--warning-dark);">
                <b style="font-size: 0.85rem; display: block; margin-bottom: 8px;"><i class="fa fa-head-side-mask modern-icon"></i> EPI Obrigatório (${p.risco_assistencial}):</b>
                <label style="margin:0; font-size:0.9rem; font-weight: 600; color: var(--warning-dark); display:flex; align-items:start; gap: 10px; cursor: pointer; text-transform:none;">
                    <input type="checkbox" class="check-seguranca" onchange="validarChecklist()" style="margin-top:2px;"> 
                    Estou usando: ${epi}
                </label>
            </div>
            `;
        }
    }

    if (p.risco_transporte === 'Alto' || (p.dispositivos && p.dispositivos.includes('Ventilação Mecânica'))) {
        htmlChecklist += `
            <div style="background:var(--danger-light); border: 1px solid var(--danger); border-radius: 12px; padding: 15px; margin-bottom: 15px; color: var(--danger-dark);">
                <b style="font-size: 0.85rem; display: block; margin-bottom: 8px;"><i class="fa fa-user-md modern-icon"></i> Equipe de Transporte de Alto Risco:</b>
                <label style="margin:0; font-size:0.9rem; font-weight: 600; color: var(--danger-dark); display:flex; align-items:start; gap: 10px; cursor: pointer; text-transform:none;">
                    <input type="checkbox" class="check-seguranca" onchange="validarChecklist()" style="margin-top:2px;"> 
                    <span>Médico(a) e Fisioterapeuta presentes no leito para monitoramento</span>
                </label>
            </div>
        `;
    }

    document.getElementById('checklist-dinamico').innerHTML = htmlChecklist;
    validarChecklist(); 
    document.getElementById('checklist-modal').style.display = 'flex'; 
}

function fecharChecklist() { document.getElementById('checklist-modal').style.display = 'none'; idChecklistAtual = null; }
function validarChecklist() { const btn = document.getElementById('btn-iniciar-viagem'); if(Array.from(document.querySelectorAll('.check-seguranca')).every(cb => cb.checked)) { btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.disabled = false; } else { btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; btn.disabled = true; } }
function confirmarChecklist() { if(idChecklistAtual) { socket.emit('iniciar_ida', idChecklistAtual); fecharChecklist(); } }

function mudarStatusMaqueiro(status) { socket.emit('mudar_status', { email: usuario.email, nome: usuario.nome, status: status }); }
socket.on('status_atualizado', (status) => { usuario.status_trabalho = status; localStorage.setItem('imaqueiro_user', JSON.stringify(usuario)); atualizarUIStatus(status); });

function toggleStatusMaqueiro() {
    if (!usuario || usuario.cargo !== 'maqueiro') return;
    const card = document.getElementById('card-status-maq');
    if (card.classList.contains('status-ocupado')) {
        return Swal.fire({ icon: 'warning', title: 'Em Rota', text: 'Você não pode entrar em intervalo enquanto estiver com um transporte em andamento!', toast: true, position: 'top-end', showConfirmButton: false, timer: 4000 });
    }
    const novoStatus = usuario.status_trabalho === 'disponivel' ? 'intervalo' : 'disponivel';
    mudarStatusMaqueiro(novoStatus); 
    if('vibrate' in navigator) navigator.vibrate(40);
}

function atualizarUIStatus(status, isOcupado = false) {
    try { 
        const card = document.getElementById('card-status-maq');
        const knobIcon = document.getElementById('status-icon');
        const statusText = document.getElementById('status-text');
        
        if(!card || !knobIcon || !statusText) return; 
        card.className = 'stat-item modern-status-card';
        
        if (isOcupado) { 
            card.classList.add('status-ocupado');
            knobIcon.className = 'fa fa-ambulance fa-fade';
            statusText.innerText = 'EM ROTA';
        } else { 
            if (status === 'intervalo') { 
                card.classList.add('status-intervalo');
                knobIcon.className = 'fa fa-mug-hot';
                statusText.innerText = 'INTERVALO';
            } else { 
                knobIcon.className = 'fa fa-running';
                statusText.innerText = 'DISPONÍVEL';
            } 
        } 
    } catch(e) { console.error("Erro no status animado", e); }
}

function abrirHistoricoModal() {
    document.getElementById('historico-maq-modal').style.display = 'flex';
}

// ============================================================================
// [09] ROTINAS DA COORDENAÇÃO (DASHBOARD, QR E MANUTENÇÃO)
// ============================================================================
function renderizarDashboardADM(ativos, historico, online) {
    try {
        let tempoTotal = 0; let viagensLidas = 0; const setoresCount = {}; const rankingCount = {};
        
        historico.forEach(p => { 
            if(p.aceito_em && p.finalizado_at) { 
                const diffMins = (new Date(p.finalizado_at) - new Date(p.aceito_em)) / 60000; 
                if(diffMins > 0 && diffMins < 300) { tempoTotal += diffMins; viagensLidas++; } 
            } 
            setoresCount[p.origem] = (setoresCount[p.origem] || 0) + 1; 
            if(p.maqueiro_ida) rankingCount[p.maqueiro_ida] = (rankingCount[p.maqueiro_ida] || 0) + 1; 
        });
        
        const emAtraso = ativos.filter(p => p.status === 'pendente').length;
        
        document.getElementById('adm-sla-time').innerText = (viagensLidas > 0 ? Math.round(tempoTotal / viagensLidas) : 0) + " min"; 
        document.getElementById('adm-total-trips').innerText = historico.length; 
        document.getElementById('adm-online-staff').innerText = online.length || 0; 
        document.getElementById('adm-delayed').innerText = emAtraso;
        
        const cardAtraso = document.getElementById('card-atrasos');
        if (cardAtraso) {
            if (emAtraso > 0) cardAtraso.classList.add('pulse-danger');
            else cardAtraso.classList.remove('pulse-danger');
        }

        const tbody = document.querySelector('#adm-live-table tbody'); tbody.innerHTML = "";
        if(ativos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fa fa-satellite-dish modern-icon" style="font-size:2.5rem; margin-bottom:10px; color:var(--success-light);"></i><br>Radar limpo. Nenhum paciente no pátio agora.</td></tr>`;
        }
        
        ativos.forEach(p => { 
            let statusTag = '';
            if(p.status === 'agendado') statusTag = `<span class="status-tag tag-agendado"><i class="fa fa-clock"></i> Agendado</span>`;
            else if(p.status === 'pendente') statusTag = `<span class="status-tag tag-pendente"><i class="fa fa-spinner fa-spin"></i> Aguardando</span>`;
            else statusTag = `<span class="status-tag tag-curso"><i class="fa fa-ambulance fa-fade"></i> Em Curso</span>`;

            tbody.innerHTML += `
            <tr class="adm-row-item" data-urgencia="${p.urgencia}" data-tipo="${p.tipo}" data-status="${p.status}">
                <td><b>#${p.id}</b></td>
                <td><i class="fa fa-user" style="color:var(--text-muted); margin-right:5px;"></i> ${p.paciente}</td>
                <td><b>${p.origem}</b> <i class="fa fa-arrow-right" style="color:var(--border-color); margin:0 5px;"></i> ${p.destino}</td>
                <td>${getUrgenciaBadge(p.urgencia)}</td>
                <td>${statusTag}</td>
                <td><b style="color:var(--primary);">${p.maqueiro_ida || p.maqueiro_sugerido || '<span style="color:var(--danger)">Procurando...</span>'}</b></td>
            </tr>`; 
        });
        
        aplicarFiltroTabelaADM();
        
        const rankingArray = Object.entries(rankingCount).sort((a, b) => b[1] - a[1]).slice(0, 5); 
        const rankingList = document.getElementById('adm-ranking-list'); rankingList.innerHTML = "";
        
        if(rankingArray.length === 0) {
            rankingList.innerHTML = `<div class="empty-state"><i class="fa fa-trophy modern-icon" style="color:var(--warning-light);"></i><p>Aguardando corridas</p></div>`;
        }
        
        rankingArray.forEach((item, index) => { 
            let medalClass = index === 0 ? "medal-gold" : index === 1 ? "medal-silver" : index === 2 ? "medal-bronze" : "";
            rankingList.innerHTML += `
            <div class="ranking-item">
                <div style="display:flex; align-items:center; gap:16px;">
                    <div class="ranking-badge ${medalClass}">${index + 1}º</div>
                    <b style="font-size:1.05rem;">${item[0]}</b>
                </div>
                <div style="font-weight:800; font-size:1.3rem; color:var(--text-main);">
                    ${item[1]} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:500;">viagens</span>
                </div>
            </div>`; 
        });
        
        if (graficoSetoresInstancia) graficoSetoresInstancia.destroy();
        const corGrafico = document.documentElement.getAttribute('data-theme') === 'dark' ? '#60A5FA' : '#4F46E5'; const corGrid = document.documentElement.getAttribute('data-theme') === 'dark' ? '#334155' : '#E2E8F0'; const corTexto = document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#64748B';
        graficoSetoresInstancia = new Chart(document.getElementById('graficoSetores').getContext('2d'), { type: 'bar', data: { labels: Object.keys(setoresCount).slice(0, 6), datasets: [{ label: 'Pedidos', data: Object.values(setoresCount).slice(0, 6), backgroundColor: corGrafico, borderRadius: 8 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: corGrid }, ticks: { color: corTexto } }, x: { grid: { display: false }, ticks: { color: corTexto } } } } });
    } catch(e) { console.error("Erro no Dashboard", e); }
}

function filtrarTabelaADM(filtro, botao) {
    filtroAtivoADM = filtro; 
    document.querySelectorAll('.filter-pill').forEach(b => { b.classList.remove('active', 'active-danger'); });
    if (botao) { if (filtro === 'vermelhos' || filtro === 'atrasos') botao.classList.add('active-danger'); else botao.classList.add('active'); }
    aplicarFiltroTabelaADM();
}

function aplicarFiltroTabelaADM() {
    document.querySelectorAll('.adm-row-item').forEach(tr => {
        let show = false; let urgencia = tr.getAttribute('data-urgencia'); let tipo = tr.getAttribute('data-tipo'); let status = tr.getAttribute('data-status');
        if(filtroAtivoADM === 'todos') show = true;
        else if(filtroAtivoADM === 'vermelhos' && urgencia === 'Vermelho') show = true;
        else if(filtroAtivoADM === 'cadeiras' && tipo === 'Cadeira de Rodas') show = true;
        else if(filtroAtivoADM === 'macas' && tipo === 'Maca') show = true;
        else if(filtroAtivoADM === 'atrasos' && status === 'pendente') show = true;
        tr.style.display = show ? '' : 'none'; 
    });
}

function filtrarDashboardPorData() {
    const inicio = document.getElementById('date-start').value;
    const fim = document.getElementById('date-end').value;
    if (!inicio || !fim) return;
    const dataInicio = new Date(inicio + "T00:00:00");
    const dataFim = new Date(fim + "T23:59:59");
    const historicoFiltrado = historicoGlobal.filter(p => {
        const dataPedido = new Date(p.finalizado_at || p.criado_em);
        return dataPedido >= dataInicio && dataPedido <= dataFim;
    });
    renderizarDashboardADM(pedidosAtivos, historicoFiltrado, []); 
}

function limparFiltroData() {
    document.getElementById('date-start').value = "";
    document.getElementById('date-end').value = "";
    renderizarDashboardADM(pedidosAtivos, historicoGlobal, []);
}

function abrirGeradorQR() {
    document.getElementById('qr-text-input').value = ""; document.getElementById('qr-code-output').innerHTML = '<span style="color: #94A3B8;">O código aparecerá aqui</span>';
    document.getElementById('btn-imprimir-qr').style.display = 'none'; document.getElementById('gerador-qr-modal').style.display = 'flex';
}

function gerarQRCodeEtiqueta() {
    const texto = document.getElementById('qr-text-input').value;
    if(!texto) return alert("Digite o nome do setor ou leito para gerar o código!");
    const container = document.getElementById('qr-code-output'); container.innerHTML = ""; 
    qrcodeGerado = new QRCode(container, { text: texto, width: 200, height: 200, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H });
    document.getElementById('btn-imprimir-qr').style.display = 'block';
}

function imprimirQR() {
    const texto = document.getElementById('qr-text-input').value; const imgData = document.querySelector('#qr-code-output img').src;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>Etiqueta iMaqueiro</title></head><body style="text-align:center; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding-top: 50px;"><div style="border: 2px dashed #000; display: inline-block; padding: 40px; border-radius: 20px;"><h2 style="margin: 0; color: #4F46E5; font-size: 24px;">iMaqueiro Enterprise</h2><p style="margin: 5px 0 20px 0; color: #666; font-size: 14px;">PONTO DE VALIDAÇÃO DE ROTA</p><h1 style="font-size: 36px; margin: 10px 0; text-transform: uppercase;">${texto}</h1><img src="${imgData}" style="width: 250px; height: 250px; margin: 20px 0;"><p style="margin: 10px 0 0 0; font-size: 18px; font-weight: bold;">Maqueiro:</p><p style="margin: 5px 0 0 0; font-size: 16px;">Escaneie este código pelo aplicativo<br>para confirmar a chegada do paciente.</p></div><script>window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); }<\/script></body></html>`);
    printWindow.document.close();
}

function exportarParaExcel() {
    if (!historicoGlobal || historicoGlobal.length === 0) return alert("Você precisa de pelo menos uma corrida finalizada no histórico para exportar.");
    const dadosPlanilha = historicoGlobal.map(p => ({ "ID do Chamado": p.id, "Paciente": p.paciente, "Origem": p.origem, "Destino": p.destino, "Modalidade": p.tipo, "Prioridade": p.urgencia, "Precaução": p.risco_assistencial, "Status Final": p.status.toUpperCase().replace(/_/g, ' '), "Maqueiro Responsável": p.maqueiro_ida || "Não atribuído", "Data de Finalização": p.finalizado_at ? new Date(p.finalizado_at).toLocaleString('pt-BR') : "Sem data" }));
    const worksheet = XLSX.utils.json_to_sheet(dadosPlanilha); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Corridas_iMaqueiro"); XLSX.writeFile(workbook, "Relatorio_Operacao_iMaqueiro.xlsx");
}

function abrirRelatorioDefeito() {
    document.getElementById('defeito-equipamento').value = 'Cadeira de Rodas';
    document.getElementById('defeito-obs').value = '';
    document.getElementById('defeito-modal').style.display = 'flex';
}

function enviarDefeito() {
    const equip = document.getElementById('defeito-equipamento').value;
    const obs = document.getElementById('defeito-obs').value;
    if(!obs) { alert("Por favor, descreva o problema!"); return; }
    let defeitos = JSON.parse(localStorage.getItem('imaqueiro_defeitos')) || [{ equip: 'Maca Padrão', obs: 'Grade lateral não trava', autor: 'Sistema' }];
    defeitos.push({ equip, obs, autor: usuario.nome.split(" ")[0] });
    localStorage.setItem('imaqueiro_defeitos', JSON.stringify(defeitos));
    document.getElementById('defeito-modal').style.display = 'none';
    document.getElementById('toast-autor').innerText = 'Manutenção'; document.getElementById('toast-msg').innerText = `Relatório enviado!`;
    document.getElementById('toast').style.display = 'flex'; document.getElementById('toast').style.borderLeft = '5px solid var(--danger)';
    setTimeout(() => document.getElementById('toast').style.display='none', 4000);
    carregarManutencao();
}

function carregarManutencao() {
    const lista = document.getElementById('adm-manutencao-list');
    if (!lista) return;
    let defeitos = JSON.parse(localStorage.getItem('imaqueiro_defeitos')) || [{ equip: 'Cadeira de Rodas', obs: 'Apoio de pé solto. Risco de queda.', autor: 'Marcos' }];
    lista.innerHTML = '';
    if(defeitos.length === 0) {
        lista.innerHTML = `<div class="empty-state" style="padding: 20px; margin-top: 0; border: 1px dashed var(--success);"><i class="fa fa-check-circle modern-icon" style="color:var(--success);"></i><p style="font-size:0.9rem;">Frota 100% Operacional</p></div>`;
    } else {
        defeitos.forEach((d, index) => {
            lista.innerHTML += `
            <div id="defeito-${index}" style="padding: 15px; border-left: 4px solid var(--danger); background: var(--input-bg); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color); position: relative; transition: 0.3s;">
                <button onclick="resolverDefeito(${index})" style="position:absolute; right:10px; top:10px; background:var(--success-light); border:1px solid var(--success); color:var(--success-dark); border-radius: 8px; padding: 6px 10px; cursor:pointer; font-size: 0.85rem; font-weight: 700; transition: 0.2s;" title="Marcar como Consertado"><i class="fa fa-check"></i> Reparado</button>
                <b style="color: var(--danger); font-size: 0.95rem;">${d.equip}</b>
                <p style="margin: 6px 0 0 0; font-size: 0.85rem; color: var(--text-main); width: 70%;">${d.obs} <br><span style="color:var(--text-muted); font-size:0.75rem; display:inline-block; margin-top:5px;"><i class="fa fa-user modern-icon"></i> Reportado por: ${d.autor}</span></p>
            </div>`;
        });
    }
}

function resolverDefeito(index) {
    const card = document.getElementById(`defeito-${index}`);
    card.classList.add('fade-out-item');
    setTimeout(() => {
        let defeitos = JSON.parse(localStorage.getItem('imaqueiro_defeitos')) || [];
        defeitos.splice(index, 1);
        localStorage.setItem('imaqueiro_defeitos', JSON.stringify(defeitos));
        carregarManutencao();
    }, 450); 
}

// ============================================================================
// [10] INTEGRAÇÕES GERAIS (TASY, CHAT E SOS)
// ============================================================================
function abrirChat(id) { idChatAtivo = id; const p = pedidosAtivos.find(x => x.id === id); const box = document.getElementById('chat-box'); box.innerHTML = (p.chat_mensagens || []).map(m => `<div class="msg ${m.autor === usuario.nome ? 'meu' : 'outro'}"><b>${m.autor}:</b> ${m.texto}</div>`).join(''); const fr = usuario.cargo === 'maqueiro' ? ["Chegando", "Elevador Ocupado", "Paciente não liberado"] : ["Aguarde", "Pode vir", "Docs prontos"]; document.getElementById('quick-replies').innerHTML = fr.map(f => `<button class="btn" style="border:1px solid var(--border-color); background:var(--card-bg); color:var(--text-main); font-size:0.8rem; border-radius:20px; padding: 8px 12px;" onclick="enviarMensagem('${f}')">${f}</button>`).join(''); document.getElementById('chat-modal').style.display = 'flex'; box.scrollTop = box.scrollHeight; }
function enviarMensagem(texto) { socket.emit('enviar_mensagem', { idPedido: idChatAtivo, texto, autor: usuario.nome }); document.getElementById('chat-modal').style.display='none'; idChatAtivo=null; }

function simularTasy() {
    const prontuario = document.getElementById('busca-tasy').value;
    if (!prontuario) { return Swal.fire('Atenção', 'Digite o número do prontuário antes de buscar.', 'warning'); }
    Swal.fire({ title: 'Consultando Tasy...', html: 'Buscando dados do paciente e leito.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    socket.emit('consultar_tasy', prontuario);
}

socket.on('retorno_tasy', (resposta) => {
    if (resposta.sucesso) {
        document.getElementById('paciente').value = resposta.dados.nome_paciente;
        document.getElementById('origem').value = resposta.dados.setor_atual + " - Leito " + resposta.dados.leito;
        document.getElementById('paciente').setAttribute('readonly', true);
        document.getElementById('origem').setAttribute('readonly', true);
        document.getElementById('paciente').style.background = 'var(--border-color)';
        document.getElementById('origem').style.background = 'var(--border-color)';
        Swal.fire({ icon: 'success', title: 'Paciente Localizado', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
    } else {
        document.getElementById('paciente').removeAttribute('readonly');
        document.getElementById('origem').removeAttribute('readonly');
        document.getElementById('paciente').style.background = 'var(--input-bg)';
        document.getElementById('origem').style.background = 'var(--input-bg)';
        Swal.fire({ icon: 'error', title: 'Não Encontrado', text: 'Prontuário não localizado no Tasy. Os campos foram liberados para digitação manual.' });
    }
});

async function emitirSOS(id) {
    const confirmacao = await Swal.fire({
        icon: 'error', title: '🚨 CÓDIGO AZUL', text: 'Isso acionará o ALARME GERAL na Coordenação e Enfermagem. O paciente teve uma parada ou piora súbita?', showCancelButton: true, confirmButtonText: 'EMERGÊNCIA! ACIONAR', cancelButtonText: 'Cancelar', confirmButtonColor: '#EF4444', cancelButtonColor: '#64748B'
    });
    if(confirmacao.isConfirmed) { socket.emit('alerta_sos', { id: id, maqueiro: usuario.nome }); }
}

socket.on('sos_disparado', async data => {
    const audio = document.getElementById('audio-emergencia');
    if(audio) { audio.currentTime = 0; audio.play().catch(()=>{}); }
    
    if (usuario.cargo === 'enfermagem' || usuario.cargo === 'coordenador') {
        const confirmacao = await Swal.fire({
            icon: 'error', title: '🚨 CÓDIGO AZUL 🚨', html: `<b style="font-size:1.2rem;">Maqueiro: ${data.maqueiro}</b><br>Solicitou resgate imediato no chamado #${data.id}!`, confirmButtonText: '<i class="fa fa-running"></i> CONFIRMAR RESGATE (Desligar Alarme)', confirmButtonColor: '#EF4444', allowOutsideClick: false, allowEscapeKey: false, backdrop: `rgba(239, 68, 68, 0.5)` 
        });
        if (confirmacao.isConfirmed) {
            if(audio) audio.pause();
            socket.emit('sos_confirmado', { id: data.id, maqueiro: data.maqueiro, enfermeiro: usuario.nome });
        }
    } else {
        document.getElementById('toast-autor').innerText = '🚨 CÓDIGO AZUL 🚨'; document.getElementById('toast-msg').innerHTML = `<b style="font-size:1.1rem;">Maqueiro: ${data.maqueiro} solicitou resgate!</b>`; document.getElementById('toast').style.display = 'flex'; document.getElementById('toast').style.background = 'var(--danger)'; document.getElementById('toast').style.borderLeft = '10px solid #7F1D1D';
        setTimeout(() => { document.getElementById('toast').style.display='none'; document.getElementById('toast').style.background = 'var(--header-bg)'; }, 15000);
    }
});

socket.on('sos_aceito', data => {
    const audio = document.getElementById('audio-emergencia');
    if(audio) audio.pause();

    if (usuario.nome === data.maqueiro) {
        Swal.fire({ icon: 'success', title: 'Equipe a Caminho!', html: `A enfermagem (<b>${data.enfermeiro}</b>) confirmou o Código Azul e está correndo para o local!`, confirmButtonColor: '#10B981', confirmButtonText: 'Entendido' });
    } else if (usuario.cargo === 'enfermagem' || usuario.cargo === 'coordenador') {
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `Resgate assumido por ${data.enfermeiro}`, showConfirmButton: false, timer: 4000 });
    }
});