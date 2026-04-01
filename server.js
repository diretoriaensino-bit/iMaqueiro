const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabaseUrl = 'https://yleinvhlnsgozeyajeom.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZWludmhsbnNnb3pleWFqZW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDY3MDQsImV4cCI6MjA5MDUyMjcwNH0.EdvC4eM8ZG-RSh1zDExmIRd-kJLtCyAOpgbxBef6ebk';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- CONFIGURAÇÃO WEB PUSH (Não perca essas chaves) ---
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
        const { data: historico } = await supabase.from('pedidos').select('*').eq('status', 'finalizado').order('finalizado_at', { ascending: false }).limit(30);
        io.emit('atualizar_lista', { ativos: ativos || [], historico: historico || [] });
    } catch (e) { console.log("Erro:", e); }
}

async function enviarPushNotificacao(maqueiroNome, titulo, corpo) {
    try {
        const { data } = await supabase.from('push_subscriptions').select('sub_info').eq('nome_maqueiro', maqueiroNome);
        if (data && data.length > 0) {
            data.forEach(sub => {
                webpush.sendNotification(sub.sub_info, JSON.stringify({ titulo, corpo })).catch(err => console.error("Erro no Push:", err));
            });
        }
    } catch (e) { console.error(e); }
}

io.on('connection', async (socket) => {
    socket.on('fazer_login', async (dados) => {
        const { data, error } = await supabase.from('usuarios').select('*').eq('email', dados.email).eq('senha', dados.senha).single(); 
        if (error) return socket.emit('login_erro', "Usuário ou senha inválidos.");
        if (data.cargo === 'maqueiro') {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== data.nome);
            maqueirosOnline.push({ id: socket.id, nome: data.nome });
        }
        socket.emit('login_sucesso', data);
    });

    socket.on('relogar_maqueiro', (u) => {
        if (u && u.cargo === 'maqueiro') {
            maqueirosOnline = maqueirosOnline.filter(m => m.nome !== u.nome);
            maqueirosOnline.push({ id: socket.id, nome: u.nome });
        }
    });

    // Salva a permissão do celular no banco
    socket.on('salvar_inscricao_push', async (d) => {
        await supabase.from('push_subscriptions').upsert([{ nome_maqueiro: d.nomeMaqueiro, sub_info: d.sub_info }], { onConflict: 'nome_maqueiro' });
    });

    socket.on('disconnect', () => { maqueirosOnline = maqueirosOnline.filter(m => m.id !== socket.id); });
    socket.on('solicitar_lista', atualizarTodos);

    socket.on('novo_pedido', async (d) => {
        let sugerido = null;
        if (maqueirosOnline.length > 0) {
            sugerido = maqueirosOnline[0].nome;
            const m = maqueirosOnline.shift();
            maqueirosOnline.push(m);
        }
        await supabase.from('pedidos').insert([{ 
            paciente: d.paciente, origem: d.origem, destino: d.destino, tipo: d.tipo, urgencia: d.urgencia, trajeto: d.trajeto, risco_assistencial: d.risco_assistencial, dispositivos: d.dispositivos, status: 'pendente', maqueiro_sugerido: sugerido
        }]);
        
        atualizarTodos();

        // SE O SISTEMA SUGERIU UM MAQUEIRO, ACORDA O CELULAR DELE!
        if (sugerido) {
            let urgenciaMsg = d.urgencia === 'Vermelho' ? '🚨 EMERGÊNCIA:' : 'Novo Transporte:';
            enviarPushNotificacao(sugerido, "iMaqueiro", `${urgenciaMsg} ${d.origem} para ${d.destino}`);
        }
    });

    socket.on('rejeitar_pedido', async (id) => {
        await supabase.from('pedidos').update({ maqueiro_sugerido: null }).eq('id', id);
        atualizarTodos();
    });

    socket.on('enviar_mensagem', async (d) => {
        const { data: p } = await supabase.from('pedidos').select('*').eq('id', d.idPedido).single();
        let h = p.chat_mensagens || [];
        h.push({ texto: d.texto, autor: d.autor, hora: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) });
        await supabase.from('pedidos').update({ chat_mensagens: h }).eq('id', d.idPedido);
        io.emit('notificacao_mensagem', d);
        atualizarTodos();
        
        // Manda notificação Push no chat se estiver no bolso
        if (p.maqueiro_ida && d.autor !== p.maqueiro_ida) enviarPushNotificacao(p.maqueiro_ida, "Mensagem da Enfermagem", d.texto);
    });

    socket.on('aceitar_chamado', async (dados) => {
        const { data: p } = await supabase.from('pedidos').select('status').eq('id', dados.idPedido).single();
        if (p && p.status === 'pendente') await supabase.from('pedidos').update({ status: 'aceito', maqueiro_ida: dados.nomeMaqueiro, aceito_em: new Date().toISOString() }).eq('id', dados.idPedido);
        else if (p && p.status === 'aguardando_retorno') await supabase.from('pedidos').update({ status: 'aceito_retorno', maqueiro_volta: dados.nomeMaqueiro, aceito_retorno_at: new Date().toISOString() }).eq('id', dados.idPedido);
        atualizarTodos();
    });
    
    socket.on('cheguei_origem', async (id) => { await supabase.from('pedidos').update({ status: 'na_origem', chegada_origem_at: new Date().toISOString() }).eq('id', id); atualizarTodos(); });
    socket.on('iniciar_ida', async (id) => { await supabase.from('pedidos').update({ status: 'em_transito_ida', inicio_transporte_at: new Date().toISOString() }).eq('id', id); atualizarTodos(); });
    
    socket.on('entregue_destino', async (id) => {
        const { data } = await supabase.from('pedidos').select('trajeto').eq('id', id).single();
        const final = (data && data.trajeto === 'so_ida') ? 'finalizado' : 'no_destino';
        await supabase.from('pedidos').update({ status: final, entrega_destino_at: new Date().toISOString(), finalizado_at: final === 'finalizado' ? new Date().toISOString() : null }).eq('id', id);
        atualizarTodos();
    });

    socket.on('pedir_retorno', async (id) => {
        let sugerido = null;
        if (maqueirosOnline.length > 0) { sugerido = maqueirosOnline[0].nome; const m = maqueirosOnline.shift(); maqueirosOnline.push(m); }
        await supabase.from('pedidos').update({ status: 'aguardando_retorno', pedido_retorno_at: new Date().toISOString(), maqueiro_sugerido: sugerido }).eq('id', id);
        atualizarTodos();
        
        // ACORDA O CELULAR PARA A VOLTA DO PACIENTE
        if (sugerido) enviarPushNotificacao(sugerido, "iMaqueiro", `🔄 Retorno de Paciente Liberado!`);
    });
    
    socket.on('finalizar_geral', async (id) => { await supabase.from('pedidos').update({ status: 'finalizado', finalizado_at: new Date().toISOString() }).eq('id', id); atualizarTodos(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iMaqueiro rodando na porta ${PORT}`));