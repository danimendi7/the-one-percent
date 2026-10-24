-- Local development seed (never used in the cloud project).
-- Allowlisted emails for the local stack. Magic-link emails are captured by Mailpit
-- (http://127.0.0.1:55324), so these addresses never receive real mail.
-- To sign in locally with your own address, add it here or run:
--   insert into private.allowed_emails (email) values ('tu@correo.com');
insert into private.allowed_emails (email, note) values
  ('owner@theonepercent.local', 'local owner account'),
  ('device-b@theonepercent.local', 'second account for RLS checks')
on conflict do nothing;

-- Accounts used by automated tests (integration + E2E).
insert into private.allowed_emails (email, note)
select format('test-%s@theonepercent.local', n), 'automated tests' from generate_series(1, 40) n
on conflict do nothing;
