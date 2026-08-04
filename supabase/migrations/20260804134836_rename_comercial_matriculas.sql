-- Mantém o nome do setor consistente entre o menu do WhatsApp e o inbox.
update public.sectors
set
  name = 'Comercial & Matrículas',
  description = 'Vagas, visitas, propostas e matrículas.'
where slug = 'comercial';
