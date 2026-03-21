
-- Insert missing profile for JL Motors admin
INSERT INTO profiles (id, clerk_user_id, name, email, organization_id, onboarding_completed)
SELECT gen_random_uuid(), up.clerk_user_id, up.full_name, up.email, om.organization_id, true
FROM users_profile up
JOIN org_members om ON om.clerk_user_id = up.clerk_user_id
WHERE up.clerk_user_id = 'user_3BD9Q7SNZ4kpKiWD38oZsuGGkkt'
AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.clerk_user_id = up.clerk_user_id)
ON CONFLICT DO NOTHING;
