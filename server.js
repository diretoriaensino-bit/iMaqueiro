const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabaseUrl = 'https://yleinvhlnsgozeyajeom.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZWludmhsbnNnb3pleWFqZW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDY3MDQsImV4cCI6MjA5MDUyMjcwNH0.EdvC4eM8ZG-RSh1zDExmIRd-kJLtCyAOpgbxBef6ebk';
const supabase = createClient(supabaseUrl, supabaseKey);

const publicVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuB22-xHhZpM8S2X_4WvXhQ6A0';
const privateVapidKey = 't1v8Q1jXgY9p37_HlQv_tH9eM5VvjF9YQ_V1x0X2oZ4';
webpush.setVapidDetails('mailto:admin@imaqueiro.com', publicVapidKey, privateVapidKey);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let maqueirosOnline = []; 

async function atualizarTodos() {
    try {
        const { data: ativos } = await supabase.from('pedidos').select('*').neq('status', 'finalizado').order('id', { ascending: false });
        const { data: historico } = await supabase.from('pedidos').select('*').eq('status', 'finalizado').order('finalizado_at', { ascending: false }).limit(100);
        io.emit('atualizar_lista', { ativos: ativos || [], historico: historico || [], online: maqueirosOnline });
    } catch (e) { console.log("Erro:", e); }
}

async function enviarPushNotificacao(maqueiroNome, titulo, corpo) {
    try {
        const { data } = await supabase.from('push_subscriptions').select('sub_info').eq('nome_maqueiro', maqueiroNome);
        if (data && data.length > 0) {
            data.forEach(sub => { webpush.sendNotification(sub.sub_info, JSON.stringify({ titulo, corpo })).catch(err => console.error("Erro Push:", err)); });
        }
    } catch (e) { console.error(e); }
}

io.on('connection', async (socket) => {
    socket.on('fazer_login', async (dados) => {
        const { data, error } = await supabase.from('usuarios').select('*').eq('email', dados.email).eq('senha', dados.senha).single(); 
        if (error) return socket.emit('login_erro', "Usuário ou senha inválidos.");
        if (data.cargo === 'maqueiro' && data.status_trabalho !== 'intervalo') {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== data.nome);
            maqueirosOnline.push({ id: socket.id, nome: data.nome, status: data.status_trabalho });
        }
        socket.emit('login_sucesso', data);
        atualizarTodos();
    });

    socket.on('relogar_maqueiro', (u) => {
        if (u && u.cargo === 'maqueiro' && u.status_trabalho !== 'intervalo') {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== u.nome);
            maqueirosOnline.push({ id: socket.id, nome: u.nome, status: u.status_trabalho });
        }
        atualizarTodos();
    });

    socket.on('mudar_status', async (dados) => {
        const { email, nome, status } = dados;
        await supabase.from('usuarios').update({ status_trabalho: status }).eq('email', email);
        if (status === 'disponivel') {
            if (!maqueirosOnline.find(m => m.nome === nome)) maqueirosOnline.push({ id: socket.id, nome: nome, status });
        } else {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== nome);
        }
        socket.emit('status_atualizado', status);
        atualizarTodos();
    });

    socket.on('solicitar_lista', atualizarTodos);

    // --- NOVA LÓGICA: MODO SIMULAÇÃO ---
    socket.on('simular_pedidos', async () => {
        const pacientes = ["Carlos Silva", "Ana Oliveira", "Marcos Pereira", "Julia Costa", "Roberto Souza"];
        const locais = ["UTI 1", "Emergência", "Raio-X", "Centro Cirúrgico", "Enfermaria 2", "Tomografia"];
        const urgencias = ["Verde", "Amarelo", "Vermelho"];
        
        let novosPedidos = [];
        for(let i=0; i<5; i++) {
            novosPedidos.push({
                paciente: pacientes[Math.floor(Math.random() * pacientes.length)] + " (SIMULADO)",
                origem: locais[Math.floor(Math.random() * locais.length)],
                destino: locais[Math.floor(Math.random() * locais.length)],
                urgencia: urgencias[Math.floor(Math.random() * urgencias.length)],
                tipo: "Maca Padrão",
                status: 'pendente'
            });
        }
        await supabase.from('pedidos').insert(novosPedidos);
        atualizarTodos();
    });

    socket.on('novo_pedido', async (d) => {
        let sugerido = null;
        if (maqueirosOnline.length > 0) { sugerido = maqueirosOnline[0].nome; const m = maqueirosOnline.shift(); maqueirosOnline.push(m); }
        await supabase.from('pedidos').insert([{ paciente: d.paciente, origem: d.origem, destino: d.destino, tipo: d.tipo, urgencia: d.urgencia, trajeto: d.trajeto, risco_assistencial: d.risco_assistencial, dispositivos: d.dispositivos, status: 'pendente', maqueiro_sugerido: sugerido }]);
        atualizarTodos();
    });

    socket.on('finalizar_geral', async (id) => { await supabase.from('pedidos').update({ status: 'finalizado', finalizado_at: new Date().toISOString() }).eq('id', id); atualizarTodos(); });
    socket.on('aceitar_chamado', async (dados) => {
        await supabase.from('pedidos').update({ status: 'aceito', maqueiro_ida: dados.nomeMaqueiro, aceito_em: new Date().toISOString() }).eq('id', dados.idPedido);
        atualizarTodos();
    });
    socket.on('disconnect', () => { maqueirosOnline = maqueirosOnline.filter(m => m.id !== socket.id); atualizarTodos(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iMaqueiro rodando na porta ${PORT}`));