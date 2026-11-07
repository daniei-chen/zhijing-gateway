package processrole

import "testing"

func TestAPIOnlyRequiresExplicitOne(t *testing.T) {
	for _, value := range []string{"", "0", "true", "1"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("ZHIJING_API_ONLY", value)
			if APIOnly() != (value == "1") {
				t.Fatal("unexpected process role")
			}
		})
	}
}
