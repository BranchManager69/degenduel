#!/bin/bash

TARGET_DIR="routes" # Default directory
SORT_BY="lines" # Default sort
REVERSE_SORT="" # Default no reverse

# --- Argument Parsing ---
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -d|--directory)
      TARGET_DIR="$2"
      shift # past argument
      shift # past value
      ;;
    -s|--sort)
      SORT_BY="$2"
      shift # past argument
      shift # past value
      ;;
    -r|--reverse)
      REVERSE_SORT="true"
      shift # past argument
      ;;
    -h|--help)
      echo "Usage: $0 [-d|--directory DIR] [-s|--sort lines|date] [-r|--reverse]"
      echo "  Analyzes .js files in the specified directory (default: routes)."
      echo "  Sorts by line count (desc) or modification date (newest)."
      exit 0
      ;;
    *)    # unknown option or positional argument
      # If it's not a known flag and TARGET_DIR is still default, assume it's the directory
      if [[ "$key" != -* ]] && [[ "$TARGET_DIR" == "routes" ]]; then
        TARGET_DIR="$1"
        shift # past argument
      else
          echo "Unknown option: $1" >&2
          echo "Usage: $0 [-d|--directory DIR] [-s|--sort lines|date] [-r|--reverse]" >&2
          exit 1
      fi
      ;;
  esac
done

# Check if target directory exists
if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory '$TARGET_DIR' not found." >&2
  exit 1
fi

# --- Data Collection ---
# Use process substitution and mapfile (bash 4+) for cleaner handling
# Store data as: EPOCH_TIMESTAMP LINE_COUNT FILE_PATH
declare -a file_data
while IFS= read -r file; do
  # Skip empty lines just in case
  [[ -z "$file" ]] && continue
  # Get epoch timestamp and line count
  # Handle potential errors from stat or wc
  epoch_time=$(stat -c %Y "$file" 2>/dev/null || echo 0)
  line_count=$(wc -l < "$file" 2>/dev/null || echo 0)
  # Add to array, ensuring no leading/trailing whitespace messes up sort fields
  file_data+=("$(printf '%s %s %s' "$epoch_time" "$line_count" "$file")")
done < <(find "$TARGET_DIR" -name '*.js' -type f) # Ensure we only find files

# Exit if no files found
if [ ${#file_data[@]} -eq 0 ]; then
  echo "No .js files found in '$TARGET_DIR' directory." >&2
  exit 0
fi

# --- Sorting ---
sort_options=""
# Use associative array for cleaner sort key mapping
declare -A sort_keys
sort_keys["lines"]="-k2,2n" # Sort by field 2 (lines), numeric
sort_keys["date"]="-k1,1n"  # Sort by field 1 (epoch), numeric

key_option="${sort_keys[$SORT_BY]}"

if [[ -z "$key_option" ]]; then
    echo "Invalid sort option: $SORT_BY. Use 'lines' or 'date'." >&2
    exit 1
fi

# Default sort order (lines descending, date newest first)
reverse_flag_for_sort="r"
if [[ -n "$REVERSE_SORT" ]]; then
    reverse_flag_for_sort="" # User wants reverse, so remove 'r' flag from sort
else
    # Default requires reverse for lines (desc) and date (newest)
    : # keep reverse_flag_for_sort="r"
fi

sort_options="$key_option$reverse_flag_for_sort"

# Use printf and sort
# The IFS trick ensures the array elements are treated as separate lines by sort
IFS=$'\n' sorted_data=($(sort $sort_options <<<"${file_data[*]}"))
unset IFS

# --- Output ---
# Determine sort description for header
sort_desc="$SORT_BY"
if [[ -n "$REVERSE_SORT" ]]; then
    if [[ "$SORT_BY" == "lines" ]]; then sort_desc="lines (ascending)";
    elif [[ "$SORT_BY" == "date" ]]; then sort_desc="date (oldest first)"; fi
else
    if [[ "$SORT_BY" == "lines" ]]; then sort_desc="lines (descending)";
    elif [[ "$SORT_BY" == "date" ]]; then sort_desc="date (newest first)"; fi
fi

echo "JS Files in '$TARGET_DIR'/ | Sorted by: $sort_desc"
echo "------------------------------------------------------------------"
printf "%-10s | %-16s | %s\n" "LINES" "MODIFIED" "FILE"
echo "------------------------------------------------------------------"
for item in "${sorted_data[@]}"; do
  # Parse the combined string back into fields
  read -r epoch_time line_count file_path <<< "$(echo "$item" | awk '{printf "%s %s ", $1, $2; for(i=3; i<=NF; ++i) printf "%s ", $i; printf "\n"}')"

  # Format date (adjust format as needed)
  mod_date=$(date -d "@$epoch_time" +'%Y-%m-%d %H:%M' 2>/dev/null || echo "Invalid Date")

  # Print formatted line
  printf "%-10s | %-16s | %s\n" "$line_count" "$mod_date" "$file_path"
done

exit 0 