-- Gerador de protocolo (/protocolo, 18/11/2026): lista os cadastros recentes do /cadastro, só leitura.
-- Não altera a tabela leads nem as políticas dela; só responde para as funções do sistema (x-sd-chave).
create or replace function public.sd_cadastros_recentes(dias integer default 45)
returns table (id uuid, nome text, whatsapp text, email text, uf text, cidade text, endereco text,
               veiculo text, placa text, quilometragem integer, servico_interesse text, observacoes text, created_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not privado.sd_acesso_ok() then return; end if;
  return query
    select l.id, l.nome, l.whatsapp, l.email, l.uf::text, l.cidade, l.endereco, l.veiculo, l.placa, l.quilometragem,
           l.servico_interesse, l.observacoes, l.created_at
      from public.leads l
     where l.created_at > now() - make_interval(days => least(greatest(coalesce(dias, 45), 1), 365))
     order by l.created_at desc
     limit 200;
end $$;
revoke all on function public.sd_cadastros_recentes(integer) from public;
grant execute on function public.sd_cadastros_recentes(integer) to anon, authenticated;
