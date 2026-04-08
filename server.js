const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// =========================================================
// MOTOR DE NOTIFICAÇÕES NATIVAS (FIREBASE)
// =========================================================
const admin = require("firebase-admin");
let serviceAccount;
if (process.env.FIREBASE_JSON) {
  // Se estiver no Render, lê a chave secreta da memória
  serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
} else {
  // Se estiver no seu PC, lê o arquivo físico
  serviceAccount = require("./firebase-key.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log("🔥 Firebase FCM ativado! O servidor agora tem permissão para furar bloqueios de tela.");

// =========================================================
// CONFIGURAÇÕES DE BANCO DE DADOS E SERVIDOR
// =========================================================
const supabaseUrl = 'https://yleinvhlnsgozeyajeom.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZWludmhsbnNnb3pleWFqZW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDY3MDQsImV4cCI6MjA5MDUyMjcwNH0.EdvC4eM8ZG-RSh1zDExmIRd-kJLtCyAOpgbxBef6ebk';
const supabase = createClient(supabaseUrl, supabaseKey);

const publicVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuB22-xHhZpM8S2X_4WvXhQ6A0';
const privateVapidKey = 't1v8Q1jXgY9p37_HlQv_tH9eM5VvjF9YQ_V1x0X2oZ4';
webpush.setVapidDetails('mailto:admin@imaqueiro.com', publicVapidKey, privateVapidKey);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Libera o acesso para qualquer aplicativo de celular
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 

let maqueirosOnline = []; 
let tokensCelulares = {}; // Guarda o endereço (token) do celular de cada maqueiro

// =========================================================
// FUNÇÃO PARA DISPARAR NOTIFICAÇÃO NATIVA (FIREBASE)
// =========================================================
async function enviarNotificacaoNativa(nomeMaqueiro, titulo, mensagem, urgencia) {
    const token = tokensCelulares[nomeMaqueiro];
    if (!token) return console.log(`[FCM] Maqueiro ${nomeMaqueiro} sem token registrado.`);

    const payload = {
        token: token,
        notification: { title: titulo, body: mensagem },
        data: { urgencia: urgencia, click_action: "FLUTTER_NOTIFICATION_CLICK" },
        android: {
            priority: "high",
            notification: { sound: urgencia === 'Vermelho' ? "emergencia" : "default" }
        }
    };

    try {
        await admin.messaging().send(payload);
        console.log(`[FCM] Notificação enviada para ${nomeMaqueiro}`);
    } catch (error) {
        console.error("[FCM] Erro ao enviar:", error);
    }
}

// =========================================================
// O DESPERTADOR INTELIGENTE
// =========================================================
setInterval(async () => {
    try {
        const { data: agendados } = await supabase.from('pedidos').select('*').eq('status', 'agendado');
        if (agendados && agendados.length > 0) {
            const agora = new Date();
            for (const p of agendados) {
                if (p.data_agendamento) {
                    const dataAgendada = new Date(p.data_agendamento);
                    const diffMinutos = (dataAgendada - agora) / 60000;
                    if (diffMinutos <= 15) {
                        let sugerido = null;
                        const disponiveis = maqueirosOnline.filter(m => m.status === 'disponivel');
                        if (disponiveis.length > 0) { sugerido = disponiveis[0].nome; }
                        await supabase.from('pedidos').update({ status: 'pendente', maqueiro_sugerido: sugerido }).eq('id', p.id);
                        if (sugerido) enviarNotificacaoNativa(sugerido, "Transporte Agendado", `Paciente: ${p.paciente}`, p.urgencia);
                        atualizarTodos();
                    }
                }
            }
        }
    } catch(e) { console.error("Erro no despertador:", e); }
}, 30000); 

async function atualizarTodos() {
    try {
        const { data: todosAtivos } = await supabase.from('pedidos').select('*').neq('status', 'finalizado').neq('status', 'cancelado');
        const { data: historico } = await supabase.from('pedidos').select('*').or('status.eq.finalizado,status.eq.cancelado').order('finalizado_at', { ascending: false }).limit(100);
        io.emit('atualizar_lista', { ativos: todosAtivos || [], historico: historico || [], online: maqueirosOnline });
    } catch (e) { console.log("Erro ao atualizar listas:", e); }
}

io.on('connection', async (socket) => {
    // Registra o endereço do celular quando o App abre
    socket.on('registrar_token_fcm', (dados) => {
        if (dados.nome && dados.token) {
            tokensCelulares[dados.nome] = dados.token;
            console.log(`[FCM] Token registrado para: ${dados.nome}`);
        }
    });
socket.on('paciente_pronto', async (id) => {
    // Atualiza no banco de dados que o paciente está pronto
    await supabase.from('pedidos').update({ pronto_pela_enfermagem: true }).eq('id', id);
    
    // Avisa todo mundo para atualizar a tela (o maqueiro verá o botão de aceitar liberar)
    atualizarTodos();
});
    socket.on('fazer_login', async (dados) => {
        const { data, error } = await supabase.from('usuarios').select('*').eq('email', dados.email).eq('senha', dados.senha).single(); 
        if (error) return socket.emit('login_erro', "Usuário ou senha inválidos.");
        if (data.cargo === 'maqueiro') {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== data.nome);
            maqueirosOnline.push({ id: socket.id, nome: data.nome, status: data.status_trabalho });
        }
        socket.emit('login_sucesso', data);
        atualizarTodos();
    });

    socket.on('mudar_status', async (dados) => {
        const { email, nome, status } = dados;
        await supabase.from('usuarios').update({ status_trabalho: status }).eq('email', email);
        let maq = maqueirosOnline.find(m => m.nome === nome);
        if (maq) maq.status = status;
        socket.emit('status_atualizado', status);
        atualizarTodos();
    });

    socket.on('novo_pedido', async (d) => {
        let sugerido = null;
        let statusInicial = d.data_agendamento ? 'agendado' : 'pendente';
        
        if (statusInicial === 'pendente') {
            const disponiveis = maqueirosOnline.filter(m => m.status === 'disponivel');
            if (disponiveis.length > 0) { sugerido = disponiveis[0].nome; }
        }

        await supabase.from('pedidos').insert([{ 
            paciente: d.paciente, origem: d.origem, destino: d.destino, tipo: d.tipo, urgencia: d.urgencia, 
            status: statusInicial, maqueiro_sugerido: sugerido,
            data_agendamento: d.data_agendamento || null
        }]);

        // GATILHO: Se houver maqueiro sugerido, manda o PUSH real no celular
        if (sugerido) {
            enviarNotificacaoNativa(sugerido, `Novo Chamado - ${d.urgencia}`, `Paciente: ${d.paciente} | Destino: ${d.destino}`, d.urgencia);
        }

        atualizarTodos();
    });

    // ... (Mantendo os outros sockets de aceitar, finalizar, etc) ...
   socket.on('aceitar_chamado', async (data) => {
    console.log(`[SOCKET] Maqueiro ${data.nomeMaqueiro} tentando aceitar chamado #${data.idPedido}`);
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .update({ 
                status: 'aceito', 
                maqueiro_ida: data.nomeMaqueiro, 
                aceito_em: new Date().toISOString() 
            })
            .eq('id', data.idPedido);

        if (error) throw error;

        console.log(`[SUCESSO] Chamado #${data.idPedido} aceito.`);
        atualizarTodos();
    } catch (err) {
        console.error("[ERRO] Falha ao aceitar chamado:", err);
    }
});

    socket.on('cancelar_pedido', async (dados) => { await supabase.from('pedidos').update({ status: 'cancelado', finalizado_at: new Date().toISOString() }).eq('id', dados.id); atualizarTodos(); });
    socket.on('finalizar_pedido', async (id) => { await supabase.from('pedidos').update({ status: 'finalizado', finalizado_at: new Date().toISOString() }).eq('id', id); atualizarTodos(); });
    socket.on('solicitar_lista', atualizarTodos);
    socket.on('disconnect', () => { maqueirosOnline = maqueirosOnline.filter(m => m.id !== socket.id); atualizarTodos(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor online na porta ${PORT}`);
});