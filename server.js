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

// LISTA DE MAQUEIROS ONLINE PARA A ROLETA
let maqueirosOnline = []; 

async function atualizarTodos() {
    const { data: pedidos } = await supabase.from('pedidos').select('*').neq('status', 'finalizado').order('id', { ascending: false });
    io.emit('atualizar_lista', pedidos);
}

io.on('connection', async (socket) => {
    
    // --- LOGIN E CONTROLE DE FILA ---
    socket.on('fazer_login', async (dados) => {
        const { data, error } = await supabase.from('usuarios').select('*').eq('email', dados.email).eq('senha', dados.senha).single(); 
        if (error) {
            socket.emit('login_erro', "E-mail ou senha incorretos.");
        } else if (data) {
            // Se for maqueiro, entra na fila da roleta!
            if (data.cargo === 'maqueiro') {
                maqueirosOnline = maqueirosOnline.filter(m => m.nome !== data.nome); // Evita duplicatas
                maqueirosOnline.push({ id: socket.id, nome: data.nome });
                console.log("Fila de Maqueiros atualizada:", maqueirosOnline.map(m => m.nome));
            }
            socket.emit('login_sucesso', data);
        }
    });

    socket.on('disconnect', () => {
        // Se o maqueiro fechar o app, sai da fila
        maqueirosOnline = maqueirosOnline.filter(m => m.id !== socket.id);
    });

    socket.on('solicitar_lista', () => atualizarTodos());

    // --- NOVO PEDIDO COM INTELIGÊNCIA ---
    socket.on('novo_pedido', async (dados) => {
        let sugerido = null;
        
        // Se tiver maqueiros online, pega o primeiro da fila
        if (maqueirosOnline.length > 0) {
            sugerido = maqueirosOnline[0].nome;
            // Joga esse maqueiro pro final da fila (Round Robin)
            const m = maqueirosOnline.shift();
            maqueirosOnline.push(m);
        }

        // AGORA SALVA O TIPO DE TRAJETO (IDA E VOLTA ou SÓ IDA)
        await supabase.from('pedidos').insert([{ 
            origem: dados.origem, 
            destino: dados.destino, 
            tipo: dados.tipo, 
            urgencia: dados.urgencia, 
            trajeto: dados.trajeto, 
            status: 'pendente', 
            maqueiro_sugerido: sugerido
        }]);
        await atualizarTodos();
    });

    // --- PASSAR A VEZ ---
    socket.on('rejeitar_pedido', async (id) => {
        // Se ele rejeitar, limpa o nome dele e joga para todos pegarem
        await supabase.from('pedidos').update({ maqueiro_sugerido: null }).eq('id', id);
        await atualizarTodos();
    });

    // --- O RESTO DOS PASSOS ---
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
    
    // --- ENTREGUE NO DESTINO (AGORA VERIFICA SE É SÓ IDA) ---
    socket.on('entregue_destino', async (id) => {
        // 1. Pergunta pro banco qual foi o trajeto escolhido pela enfermagem
        const { data } = await supabase.from('pedidos').select('trajeto').eq('id', id).single();
        
        // 2. Se for Só Ida, já finaliza. Se não, fica no destino esperando retorno.
        const novoStatus = (data && data.trajeto === 'so_ida') ? 'finalizado' : 'no_destino';

        await supabase.from('pedidos').update({ 
            status: novoStatus, 
            entrega_destino_at: new Date().toISOString(),
            finalizado_at: novoStatus === 'finalizado' ? new Date().toISOString() : null
        }).eq('id', id);
        
        await atualizarTodos();
    });

    socket.on('pedir_retorno', async (id) => {
        await supabase.from('pedidos').update({ status: 'aguardando_retorno', pedido_retorno_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
    
    socket.on('aceitar_retorno', async (dados) => {
        await supabase.from('pedidos').update({ status: 'aceito_retorno', maqueiro_volta: dados.nomeMaqueiro, aceito_retorno_at: new Date().toISOString() }).eq('id', dados.idPedido);
        await atualizarTodos();
    });
    
    socket.on('finalizar_geral', async (id) => {
        await supabase.from('pedidos').update({ status: 'finalizado', finalizado_at: new Date().toISOString() }).eq('id', id);
        await atualizarTodos();
    });
});

// --- PORTA DINÂMICA PARA O RENDER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iMaqueiro rodando com Roleta Inteligente em http://localhost:${PORT}`));