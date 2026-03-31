const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://yleinvhlnsgozeyajeom.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZWludmhsbnNnb3pleWFqZW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDY3MDQsImV4cCI6MjA5MDUyMjcwNH0.EdvC4eM8ZG-RSh1zDExmIRd-kJLtCyAOpgbxBef6ebk';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let maqueirosOnline = []; 

async function atualizarTodos() {
    const { data: pedidos } = await supabase.from('pedidos').select('*').neq('status', 'finalizado').order('id', { ascending: false });
    io.emit('atualizar_lista', pedidos);
}

io.on('connection', async (socket) => {
    socket.on('fazer_login', async (dados) => {
        const { data, error } = await supabase.from('usuarios').select('*').eq('email', dados.email).eq('senha', dados.senha).single(); 
        if (error) {
            socket.emit('login_erro', "E-mail ou senha incorretos.");
        } else if (data) {
            if (data.cargo === 'maqueiro') {
                maqueirosOnline = maqueirosOnline.filter(m => m.nome !== data.nome);
                maqueirosOnline.push({ id: socket.id, nome: data.nome });
            }
            socket.emit('login_sucesso', data);
        }
    });

    socket.on('disconnect', () => {
        maqueirosOnline = maqueirosOnline.filter(m => m.id !== socket.id);
    });

    socket.on('solicitar_lista', () => atualizarTodos());

    socket.on('novo_pedido', async (dados) => {
        let sugerido = null;
        if (maqueirosOnline.length > 0) {
            sugerido = maqueirosOnline[0].nome;
            const m = maqueirosOnline.shift();
            maqueirosOnline.push(m);
        }
        await supabase.from('pedidos').insert([{ 
            paciente: dados.paciente, origem: dados.origem, destino: dados.destino, 
            tipo: dados.tipo, urgencia: dados.urgencia, trajeto: dados.trajeto, 
            risco_assistencial: dados.risco_assistencial, status: 'pendente', maqueiro_sugerido: sugerido
        }]);
        await atualizarTodos();
    });

    socket.on('enviar_mensagem', async (dados) => {
        const { idPedido, texto, autor } = dados;
        const { data: pedido } = await supabase.from('pedidos').select('chat_mensagens').eq('id', idPedido).single();
        let historico = pedido.chat_mensagens || [];
        historico.push({ texto, autor, hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}) });
        await supabase.from('pedidos').update({ chat_mensagens: historico }).eq('id', idPedido);
        await atualizarTodos();
    });

    socket.on('rejeitar_pedido', async (id) => {
        await supabase.from('pedidos').update({ maqueiro_sugerido: null }).eq('id', id);
        await atualizarTodos();
    });

    socket.on('aceitar_ida', async (dados) => {
        await supabase.from('pedidos').update({ status: 'aceito', maqueiro_ida: dados.nomeMaqueiro, aceito_em: new Date().toISOString() }).eq('id', dados.idPedido);
        await atualizarTodos();
    });
    
    socket.on('cheguei_origem', async (id) => {
        await supabase.from('pedidos').update({ status: 'na_origem', chegada_origem_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
    
    socket.on('iniciar_ida', async (id) => {
        await supabase.from('pedidos').update({ status: 'em_transito_ida', inicio_transporte_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
    
    socket.on('entregue_destino', async (id) => {
        const { data } = await supabase.from('pedidos').select('trajeto').eq('id', id).single();
        const novoStatus = (data && data.trajeto === 'so_ida') ? 'finalizado' : 'no_destino';
        await supabase.from('pedidos').update({ 
            status: novoStatus, entrega_destino_at: new Date().toISOString(),
            finalizado_at: novoStatus === 'finalizado' ? new Date().toISOString() : null
        }).eq('id', id);
        await atualizarTodos();
    });

    socket.on('pedir_retorno', async (id) => {
        await supabase.from('pedidos').update({ status: 'aguardando_retorno', pedido_retorno_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
    
    socket.on('finalizar_geral', async (id) => {
        await supabase.from('pedidos').update({ status: 'finalizado', finalizado_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iMaqueiro rodando em http://localhost:${PORT}`));